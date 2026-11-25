import "server-only";
import { randomUUID } from "node:crypto";
import {
  descriptorDigest,
  type ActionDescriptor,
} from "@nodrail/client/protocol";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import type { DecisionCode } from "@/contracts/v1/activity";
import {
  evaluationOfVerdict,
  hostDecisionInput,
  hostDecisionsInput,
  type HostDecisionInput,
  type HostDecisionResult,
  type HostDecisionsDto,
  type HostVerdict,
} from "@/contracts/v1/runtime-decisions";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { recordRuntimeDecision } from "@/server/modules/audit";
import { attachSharedBudgets } from "@/server/modules/budgets/host-settle";
import { lockHostCalls } from "@/server/modules/budgets/host-order";
import { consumeIntent } from "@/server/modules/billing/metering";
import { liveRunPolicy } from "@/server/modules/runs/history";
import { enterRun } from "@/server/modules/runs/steps";
import {
  agentAccess,
  insertRequest,
  observe,
  observedOutcome,
} from "./records";
import { liveRevision, policySkew } from "./policy-revision";
import { recordSubject } from "./subject";
import { touch } from "./touch";

/**
 * Calls the hook decided on its host go into the same records as Cloud
 * decisions: an action request in its run, in arrival order, an Activity
 * event, the inventory and the month's usage. Cloud never decides them
 * again. The host’s outcome can settle an existing shared budget lease.
 */

const codeOf: Record<HostVerdict, DecisionCode> = {
  allow: "allowed_by_rule",
  deny: "denied_by_rule",
};

/**
 * The version a host's row names: the one in this environment published
 * from the file the host decided with, else the live one. Neither changes
 * what the host decided; the digest says what it ran.
 */
type Revision = NonNullable<Awaited<ReturnType<typeof liveRevision>>>;

async function versionFor(
  context: RuntimeContext,
  digest: string | null,
  live: Revision,
) {
  if (!digest || digest === live.source_digest) return live.id;
  const [historical]: { id: string }[] = await context.manager.query(
    `SELECT id FROM nodrail.policy_versions
     WHERE workspace_id = $1 AND environment_id = $2 AND source_digest = $3
     ORDER BY revision DESC LIMIT 1`,
    [context.workspaceId, context.environmentId, digest],
  );
  return historical?.id ?? live.id;
}

/** The key's row, if this installation used it: a retry answers with it. */
async function known(
  context: RuntimeContext,
  key: string,
  bodyDigest: string,
): Promise<{ key: string; action_id: string } | null> {
  const [row]: {
    id: string;
    decided_by: string;
    body_digest: string | null;
  }[] = await context.manager.query(
    `SELECT id, decided_by, body_digest FROM nodrail.action_requests
       WHERE workspace_id = $1 AND installation_id = $2 AND idempotency_key = $3`,
    [context.workspaceId, context.installationId, key],
  );
  if (!row) return null;
  // Another payload, or a call Cloud decided, under the same key.
  if (row.decided_by !== "host" || row.body_digest !== bodyDigest)
    throw new AppError("IDEMPOTENCY_CONFLICT");
  return { key, action_id: row.id };
}

async function recordOne(
  context: RuntimeContext,
  input: HostDecisionInput,
  lockRuns: boolean,
  live: Revision,
): Promise<HostDecisionResult> {
  const { idempotency_key: key, run, verdict } = input;
  const descriptor: ActionDescriptor = {
    tool: input.tool,
    operation: input.operation,
    resource: input.resource,
    params: input.params,
  };
  const bodyDigest = fingerprint(input);
  const replayed = await known(context, key, bodyDigest);
  const attach = async (actionId: string) => {
    if (verdict === "allow")
      await attachSharedBudgets(context, actionId, key, input.policy_digest);
    return { key, action_id: actionId };
  };
  if (replayed) return attach(replayed.action_id);

  const policyVersionId = await versionFor(context, input.policy_digest, live);
  const place = run
    ? await enterRun(context, { key: run.key, step: run.step }, lockRuns)
    : null;
  const evaluation = evaluationOfVerdict[verdict];
  const id = randomUUID();
  const digest = descriptorDigest(context.installationId, descriptor);
  const inserted = await insertRequest(context, {
    id,
    key,
    adapterVersion: input.adapter_version,
    descriptor,
    digest,
    policyVersionId,
    accessEpoch: (await agentAccess(context)).epoch,
    evaluation,
    place,
    hold: null,
    host: {
      policyDigest: input.policy_digest,
      policySkew: policySkew(input.policy_digest, live.source_digest),
      rule: input.rule ?? null,
      reason: input.reason ?? null,
      decidedAt: input.decided_at,
      bodyDigest,
    },
  });
  if (!inserted) {
    const winner = await known(context, key, bodyDigest);
    if (!winner) throw new AppError("BUSY");
    return attach(winner.action_id);
  }
  const result = await attach(id);
  await recordSubject(context, id, "submit", run?.subject);
  await consumeIntent(context);
  await observe(
    context,
    descriptor,
    id,
    observedOutcome(evaluation, !input.rule),
  );
  await recordRuntimeDecision(context, {
    eventType: "authorization.host_decided",
    decisionCode: codeOf[verdict],
    actionRequestId: id,
    agentId: context.agentId,
    environmentId: context.environmentId,
    policyVersionId,
  });
  return result;
}

const keyOf = (raw: unknown) => {
  const key = (raw as { idempotency_key?: unknown } | null)?.idempotency_key;
  return typeof key === "string" && key.length <= 128 ? key : null;
};

/**
 * One item, in its own savepoint: what Cloud refuses for it (a bad item, a
 * key used for another payload, the month's allowance) leaves nothing
 * behind and answers its code; anything else fails the whole request.
 */
async function recordItem(
  context: RuntimeContext,
  raw: unknown,
  lockRuns: boolean,
  live: Revision,
): Promise<HostDecisionResult> {
  const parsed = hostDecisionInput.safeParse(raw);
  if (!parsed.success)
    return { key: keyOf(raw), error: { code: "INVALID_INPUT" } };
  const { manager } = context;
  await manager.query("SAVEPOINT host_decision");
  try {
    const result = await recordOne(context, parsed.data, lockRuns, live);
    await manager.query("RELEASE SAVEPOINT host_decision");
    return result;
  } catch (error) {
    if (!(error instanceof AppError) || error.code === "BUSY") throw error;
    await manager.query("ROLLBACK TO SAVEPOINT host_decision");
    return { key: parsed.data.idempotency_key, error: { code: error.code } };
  }
}

/** `POST /runtime/decisions`: each item's row or why not, in order. */
export async function recordHostDecisions(
  context: RuntimeContext,
  rawInput: unknown,
): Promise<HostDecisionsDto> {
  const { decisions } = parseInput(hostDecisionsInput, rawInput);
  await lockHostCalls(context);
  await touch(context);
  // Runs are held while an event is placed exactly when decisions read
  // their history, as for steps: then every place follows commit order.
  const live = await liveRevision(context);
  if (!live) throw new AppError("BUSY");
  const lockRuns = liveRunPolicy(live.run_policy) !== null;
  const results: HostDecisionResult[] = [];
  for (const raw of decisions)
    results.push(await recordItem(context, raw, lockRuns, live));
  return { results };
}
