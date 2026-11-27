import "server-only";
import { randomUUID } from "node:crypto";
import {
  descriptorDigest,
  redactPausedAction,
  type ActionDescriptor,
} from "@nodrail/client/protocol";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import { lateHostReport, type DecisionCode } from "@/contracts/v1/activity";
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
import { insertRequest, observe, observedOutcome } from "./records";
import { callerStep, runtimeCaller } from "./caller";
import { admitted } from "./admission";
import {
  liveRevision,
  pinnedRevision,
  policySkew,
  requirePolicyOwnership,
} from "./policy-revision";
import { existingRun, pauseDetail } from "./pause-decisions";
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
  would_deny: "would_deny",
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
  if (context.enrollmentProjectId) {
    const pin = digest && (await pinnedRevision(context, digest));
    if (!pin) throw new AppError("NOT_FOUND");
    return pin;
  }
  if (!digest || digest === live.source_digest) return live;
  return (await pinnedRevision(context, digest)) ?? live;
}

type Recorded = { id: string; access_epoch: number; historical: boolean };

/** The key's row, if this installation used it: a retry answers with it. */
async function known(context: RuntimeContext, key: string, bodyDigest: string) {
  const [row]: (Recorded & {
    decided_by: string;
    body_digest: string | null;
  })[] = await context.manager.query(
    `SELECT ar.id, ar.decided_by, ar.body_digest, ar.access_epoch,
       EXISTS (SELECT 1 FROM nodrail.audit_events ev
         WHERE ev.workspace_id = ar.workspace_id AND ev.action_request_id = ar.id
           AND ev.decision_code = 'host_reported_late') AS historical
     FROM nodrail.action_requests ar
     WHERE ar.workspace_id = $1 AND ar.installation_id = $2 AND ar.idempotency_key = $3`,
    [context.workspaceId, context.installationId, key],
  );
  if (!row) return null;
  // Another payload, or a call Cloud decided, under the same key.
  if (row.decided_by !== "host" || row.body_digest !== bodyDigest)
    throw new AppError("IDEMPOTENCY_CONFLICT");
  return row;
}

async function acknowledge(
  caller: Awaited<ReturnType<typeof runtimeCaller>>,
  input: HostDecisionInput,
  { id, access_epoch, historical }: Recorded,
): Promise<HostDecisionResult> {
  const key = input.idempotency_key;
  if (
    !caller.refusal &&
    input.verdict === "allow" &&
    caller.epoch === access_epoch
  )
    await attachSharedBudgets(caller.context, id, key, input.policy_digest);
  return {
    key,
    action_id: id,
    ...(historical ? { status: lateHostReport } : {}),
  };
}

async function recordOne(
  context: RuntimeContext,
  input: HostDecisionInput,
  live: Revision,
): Promise<HostDecisionResult> {
  const { idempotency_key: key, verdict } = input;
  const caller = await runtimeCaller(context, input.agent);
  context = caller.context;
  const action: ActionDescriptor = {
    tool: input.tool,
    operation: input.operation,
    resource: input.resource,
    params: input.params,
  };
  const bodyDigest = fingerprint(input);
  const replayed = await known(context, key, bodyDigest);
  if (replayed) return acknowledge(caller, input, replayed);
  const paused = !!input.paused_agents;
  const historical = !admitted(caller, input);
  const descriptor = paused ? redactPausedAction(action) : action;
  const epoch = historical || paused ? 0 : caller.epoch;
  const version = await versionFor(context, input.policy_digest, live);
  const policyVersionId = version.id;
  const place = await decisionPlace(caller, input.run, version, {
    paused,
    historical,
  });
  const pause = paused && !historical ? pauseDetail(caller) : null;
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
    accessEpoch: epoch,
    evaluation,
    place,
    hold: null,
    host: {
      policyDigest: input.policy_digest,
      policySkew: policySkew(input.policy_digest, live.source_digest),
      rule: paused ? null : (input.rule ?? null),
      reason: hostReason(input, pause),
      decidedAt: input.decided_at,
      bodyDigest,
    },
  });
  if (!inserted) {
    const winner = await known(context, key, bodyDigest);
    if (!winner) throw new AppError("BUSY");
    return acknowledge(caller, input, winner);
  }
  const result = await acknowledge(caller, input, {
    id,
    access_epoch: epoch,
    historical,
  });
  if (!historical && !paused)
    await recordLiveEffects(context, input, { id, descriptor, evaluation });
  await recordRuntimeDecision(context, {
    ...decisionAudit(input, { historical, pause }),
    actionRequestId: id,
    agentId: context.agentId,
    environmentId: context.environmentId,
    policyVersionId,
  });
  return result;
}

function hostReason(input: HostDecisionInput, pause: string | null) {
  return input.paused_agents ? pause : (input.reason ?? null);
}

function decisionPlace(
  caller: Awaited<ReturnType<typeof runtimeCaller>>,
  run: HostDecisionInput["run"],
  version: Pick<Revision, "run_policy">,
  { paused, historical }: { paused: boolean; historical: boolean },
) {
  if (paused) return existingRun(caller.context, run?.key);
  if (!run || historical) return null;
  return enterRun(
    caller.context,
    { key: run.key, step: callerStep(caller, run.step) },
    liveRunPolicy(version.run_policy) !== null,
  );
}

function decisionAudit(
  input: HostDecisionInput,
  { historical, pause }: { historical: boolean; pause: string | null },
) {
  return {
    eventType: historical
      ? "authorization.host_reported_late"
      : "authorization.host_decided",
    decisionCode: pause
      ? ("denied_agent_paused" as const)
      : historical
        ? ("host_reported_late" as const)
        : codeOf[input.verdict],
    payload: {
      ...(input.check_token ? { check_token: input.check_token } : {}),
      ...(pause ? { detail: pause } : {}),
    },
  };
}

async function recordLiveEffects(
  context: RuntimeContext,
  { run, verdict, rule }: HostDecisionInput,
  {
    id,
    descriptor,
    evaluation,
  }: {
    id: string;
    descriptor: ActionDescriptor;
    evaluation: (typeof evaluationOfVerdict)[HostVerdict];
  },
) {
  await recordSubject(context, id, "submit", run?.subject);
  await consumeIntent(context);
  if (verdict !== "would_deny")
    await observe(context, descriptor, id, observedOutcome(evaluation, !rule));
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
  live: Revision,
): Promise<HostDecisionResult> {
  const parsed = hostDecisionInput.safeParse(raw);
  if (!parsed.success)
    return { key: keyOf(raw), error: { code: "INVALID_INPUT" } };
  const { manager } = context;
  await manager.query("SAVEPOINT host_decision");
  try {
    const result = await recordOne(context, parsed.data, live);
    await manager.query("RELEASE SAVEPOINT host_decision");
    return result;
  } catch (error) {
    if (!(error instanceof AppError) || error.code === "BUSY") throw error;
    await manager.query("ROLLBACK TO SAVEPOINT host_decision");
    return {
      key: parsed.data.idempotency_key,
      error: {
        code: error.code,
        ...(error.detail ? { message: error.detail } : {}),
      },
    };
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
  await requirePolicyOwnership(context, live);
  if (!live) throw new AppError("BUSY");
  const results: HostDecisionResult[] = [];
  for (const raw of decisions)
    results.push(await recordItem(context, raw, live));
  return { results };
}
