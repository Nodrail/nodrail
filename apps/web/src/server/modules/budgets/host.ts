import "server-only";
import type { NumericBudget } from "@nodrail/policy-engine";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import { covers } from "@nodrail/policy-engine/ledger";
import {
  reserveSharedInput,
  type SharedBudgetReply,
  type SharedBudgetRequest,
} from "@/contracts/v1/runtime-budgets";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { liveRunPolicy } from "@/server/modules/runs/history";
import { liveRevision } from "@/server/modules/runtime/policy-revision";
import { agentAccess } from "@/server/modules/runtime/records";
import { touch } from "@/server/modules/runtime/touch";
import { decisionExists, lockHostCalls } from "./host-order";
import { admitCoverings, windowFor, writeReservations } from "./reserve";

const LEASE_MS = 5 * 60_000;

function amountFor(
  budget: NumericBudget,
  amounts: SharedBudgetRequest["amounts"],
) {
  if (budget.source !== "admission") return null;
  if (budget.measure.kind === "count") return 1;
  return amounts && Object.hasOwn(amounts, budget.id)
    ? amounts[budget.id]!
    : null;
}

function requestCoverings(
  input: SharedBudgetRequest,
  limits: readonly NumericBudget[] | undefined,
  now: Date,
) {
  const place = input.run
    ? { key: input.run.key, step: input.run.step ?? null, runId: null }
    : null;
  const agent = place?.step?.agent ?? "main";
  return (limits ?? []).flatMap((budget) => {
    if (
      budget.across !== "environment" ||
      !input.calls.some((call) =>
        covers(budget, { ...call, values: null }, agent),
      )
    )
      return [];
    return [
      {
        budget,
        window: windowFor(budget, place, now),
        amount: amountFor(budget, input.amounts),
      },
    ];
  });
}

/** The first request owns the fingerprint, even when its budgets did not fit. */
async function claim(context: RuntimeContext, input: SharedBudgetRequest) {
  const { manager, workspaceId, installationId } = context;
  const key = [workspaceId, installationId, input.call_fingerprint];
  const digest = fingerprint(input);
  const [created]: { id: string }[] = await manager.query(
    `INSERT INTO nodrail.budget_leases (workspace_id, installation_id, call_key, body_digest, policy_digest)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, installation_id, call_key) DO NOTHING RETURNING id`,
    [...key, digest, input.policy_digest],
  );
  if (created) return { id: created.id };

  const [known]: {
    body_digest: string;
    response: SharedBudgetReply;
    active: boolean;
  }[] = await manager.query(
    `SELECT l.body_digest, l.response, EXISTS (
         SELECT 1 FROM nodrail.budget_reservations r
         WHERE r.workspace_id = l.workspace_id AND r.lease_id = l.id
           AND r.state = 'reserved' AND r.started_at IS NULL
           AND r.unknown_after > clock_timestamp()
       ) AS active
       FROM nodrail.budget_leases l
       WHERE l.workspace_id = $1 AND l.installation_id = $2 AND l.call_key = $3`,
    key,
  );
  if (!known) throw new AppError("BUSY");
  if (known.body_digest !== digest) throw new AppError("IDEMPOTENCY_CONFLICT");
  return {
    replay:
      known.response.expires_at && !known.active
        ? {
            ...known.response,
            expires_at: null,
            reason: "Shared budget lease expired or was already claimed.",
          }
        : known.response,
  };
}

export async function reserveSharedBudgets(
  context: RuntimeContext,
  rawInput: unknown,
): Promise<SharedBudgetReply> {
  const input = parseInput(reserveSharedInput, rawInput);
  const live = await liveRevision(context);
  if (!live || live.source_digest !== input.policy_digest)
    return {
      limits: [],
      expires_at: null,
      reason: "The host policy differs from the published policy.",
    };
  if ((await agentAccess(context)).paused)
    return { limits: [], expires_at: null, reason: "The agent is paused." };
  // A contended window can be retried as a fresh call. The hook has its own
  // short deadline and never waits for a reservation to become available.
  await context.manager.query("SET LOCAL lock_timeout = '250ms'");
  await lockHostCalls(context);
  const lease = await claim(context, input);
  if (lease.replay) return lease.replay;
  if (await decisionExists(context, input.call_fingerprint)) {
    const response = {
      limits: [],
      expires_at: null,
      reason: "This call was already decided.",
    };
    await saveResponse(context, lease.id, response);
    return response;
  }
  const policy = liveRunPolicy(live.run_policy);
  const now = await databaseTime(context);
  const coverings = requestCoverings(input, policy?.limits, now);
  const admission = await admitCoverings(context, coverings, now, true);
  const limits = admission.standings;
  let expires_at: string | null = null;
  if (limits.length && limits.every(({ state }) => state === "ok")) {
    const at = await databaseTime(context);
    const deadline = Math.min(
      at.getTime() + LEASE_MS,
      ...coverings.map(({ window }) => window?.endsAt?.getTime() ?? Infinity),
    );
    // A window can roll over while admission is acquiring its locks.
    if (deadline > at.getTime()) {
      const expires = new Date(deadline);
      await writeReservations(
        context,
        { leaseId: lease.id, unknownAfter: expires, createdAt: at },
        admission,
      );
      expires_at = expires.toISOString();
    }
  }
  const response = { limits, expires_at };
  await saveResponse(context, lease.id, response);
  await touch(context);
  return response;
}

async function databaseTime(context: RuntimeContext) {
  const [{ at }]: { at: Date }[] = await context.manager.query(
    "SELECT clock_timestamp() AS at",
  );
  return at;
}

async function saveResponse(
  context: RuntimeContext,
  id: string,
  response: SharedBudgetReply,
) {
  await context.manager.query(
    "UPDATE nodrail.budget_leases SET response = $3::jsonb WHERE workspace_id = $1 AND id = $2",
    [context.workspaceId, id, JSON.stringify(response)],
  );
}
