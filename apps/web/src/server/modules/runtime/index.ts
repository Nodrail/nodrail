import "server-only";
import { randomUUID } from "node:crypto";
import {
  descriptorDigest,
  nonceDigest,
  type ActionDescriptor,
  type ActionStatus,
  type PermitResponse,
} from "@nodrail/client/protocol";
import {
  PERMIT_TTL_SECONDS,
  heartbeatInput,
  idempotencyKey,
  permitInput,
  reportInput,
  submitActionInput,
} from "@/contracts/v1/runtime";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { ClientReport, DecisionPermit } from "@/server/db/entities";
import { recordRuntimeDecision } from "@/server/modules/audit";
import { reserve } from "@/server/modules/budgets/reserve";
import { readingFor, settle } from "@/server/modules/budgets/settle";
import { consumeIntent } from "@/server/modules/billing/metering";
import { holdOf, placeOf } from "@/server/modules/runs/history";
import { enterRun } from "@/server/modules/runs/steps";
import { activePolicy, initialFor, judge, readsRuns } from "./decide";
import {
  agentAccess,
  insertRequest,
  noteHold,
  observe,
  observedOutcome,
  placeWhenAhead,
} from "./records";
import {
  findByKey,
  loadAction,
  toCode,
  toStatus,
  type StatusRow,
} from "./status";
import { recordSubject } from "./subject";
import { recordPolicyHeartbeat } from "./policy-revision";
import { touch } from "./touch";

/**
 * A repeat of the same call returns its first result and never a second one.
 * A key the host already used for a call it decided is another request.
 */
async function replay(
  context: RuntimeContext,
  existing: StatusRow,
  digest: string,
) {
  if (existing.descriptor_digest !== digest || existing.decided_by === "host")
    throw new AppError("IDEMPOTENCY_CONFLICT");
  await context.manager.query(
    `UPDATE nodrail.action_requests
     SET attempt_count = attempt_count + 1, last_attempt_at = clock_timestamp()
     WHERE workspace_id = $1 AND id = $2`,
    [context.workspaceId, existing.id],
  );
  return toStatus(existing, context);
}

/**
 * Records what the agent wants to do and what the rules say. READY only means a
 * permit may be requested: nothing here lets a tool run.
 */
export async function submitAction(
  context: RuntimeContext,
  rawKey: unknown,
  rawInput: unknown,
): Promise<ActionStatus> {
  const key = parseInput(idempotencyKey, rawKey);
  const {
    adapter_version: adapterVersion,
    run: declared,
    ...descriptor
  } = parseInput(submitActionInput, rawInput);
  const { agentId, environmentId } = context;
  const digest = descriptorDigest(context.installationId, descriptor);
  await touch(context, adapterVersion);

  const known = await findByKey(context, key);
  if (known) return replay(context, known, digest);

  const policy = await activePolicy(context);
  const place = declared
    ? await enterRun(
        context,
        { key: declared.key, step: declared.step },
        readsRuns(policy),
      )
    : null;
  const decided = await judge(context, policy, descriptor, { place });
  const { policyVersionId, verdict } = decided;
  const access = await agentAccess(context);
  const evaluation = access.paused ? "denied" : initialFor[verdict.outcome];
  const hold = access.paused ? null : holdOf(verdict);

  const id = randomUUID();
  const inserted = await insertRequest(context, {
    id,
    key,
    adapterVersion,
    descriptor,
    digest,
    policyVersionId,
    accessEpoch: access.epoch,
    evaluation,
    place,
    hold,
  });
  if (!inserted) {
    const winner = await findByKey(context, key);
    if (!winner) throw new AppError("BUSY");
    return replay(context, winner, digest);
  }
  await recordSubject(context, id, "submit", declared?.subject);

  await consumeIntent(context);
  const held = noteHold(context, id, hold);
  // No rule covers it: denied, and said so, so a person can add one.
  const unmatched = !access.paused && verdict.outcome === "none";

  if (evaluation === "denied")
    await recordRuntimeDecision(context, {
      eventType: "authorization.decided",
      decisionCode: access.paused
        ? "denied_agent_paused"
        : unmatched
          ? "denied_no_rule"
          : "denied_by_rule",
      actionRequestId: id,
      agentId,
      environmentId,
      policyVersionId,
      matchedLogicalRuleId: verdict.matchedRuleId ?? undefined,
      payload: held,
    });
  await observe(
    context,
    descriptor,
    id,
    observedOutcome(evaluation, unmatched),
  );
  return toStatus(await loadAction(context, id), context);
}

export async function getActionStatus(
  context: RuntimeContext,
  actionId: string,
): Promise<ActionStatus & { policy_skew?: boolean | null }> {
  return toStatus(await loadAction(context, actionId), context);
}

export async function findActionByKey(
  context: RuntimeContext,
  rawKey: unknown,
): Promise<ActionStatus> {
  const row = await findByKey(context, parseInput(idempotencyKey, rawKey));
  if (!row) throw new AppError("NOT_FOUND");
  return toStatus(row, context);
}

function blocked(
  row: StatusRow,
  code: Exclude<ActionStatus["code"], "READY" | "PERMIT_ISSUED">,
  reason: string | null,
): PermitResponse {
  return { code, action_id: row.id, reason };
}

/**
 * The same decision the submit made, against the state now: the active
 * version, and the run's history as it stands, so a builder that has started
 * again since then closes its gate again.
 */
async function recheck(context: RuntimeContext, row: StatusRow) {
  const descriptor = {
    tool: row.tool_key,
    operation: row.operation_key,
    resource: { kind: row.resource_kind, id: row.resource_id },
    params: row.params_safe as ActionDescriptor["params"],
  };
  const policy = await activePolicy(context);
  const place = await placeOf(context, row.id, readsRuns(policy));
  return judge(context, policy, descriptor, {
    place,
    beforeActionId: row.id,
    lock: true,
  });
}

async function issuePermit(
  context: RuntimeContext,
  row: StatusRow,
  policyVersionId: string,
  input: { nonce: string; subject?: string | null },
) {
  const { nonce } = input;
  const [times]: { issued_at: Date; expires_at: Date }[] =
    await context.manager.query(
      `SELECT clock_timestamp() AS issued_at,
              clock_timestamp() + make_interval(secs => $1) AS expires_at`,
      [PERMIT_TTL_SECONDS],
    );
  if (!times) throw new AppError("BUSY");
  const permitId = randomUUID();
  await context.manager.insert(DecisionPermit, {
    id: permitId,
    workspaceId: context.workspaceId,
    actionRequestId: row.id,
    policyVersionId,
    credentialId: context.credentialId,
    issuedAt: times.issued_at,
    expiresAt: times.expires_at,
    claimNonceDigest: nonceDigest(nonce),
  });
  await recordSubject(context, row.id, "permit", input.subject);
  const response: PermitResponse = {
    code: "ALLOW",
    permit_id: permitId,
    action_id: row.id,
    action_digest: row.action_digest,
    installation_id: context.installationId,
    claim_nonce: nonce,
    policy_version_id: policyVersionId,
    access_epoch: row.current_epoch,
    issued_at: times.issued_at.toISOString(),
    expires_at: times.expires_at.toISOString(),
  };
  return { response, permit: { id: permitId, expiresAt: times.expires_at } };
}

/**
 * The one place a tool can be cleared to run. Everything is checked again here,
 * against live state, and the action row lock allows a single permit ever.
 */
export async function requestPermit(
  context: RuntimeContext,
  actionId: string,
  rawInput: unknown,
): Promise<PermitResponse> {
  const input = parseInput(permitInput, rawInput);
  const { manager, workspaceId, agentId, environmentId } = context;
  await loadAction(context, actionId);
  await manager.query(
    `SELECT 1 FROM nodrail.action_requests
     WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, actionId],
  );
  const row = await loadAction(context, actionId);
  await touch(context);

  // The host decided it and it ran, or didn't, there: never cleared here.
  if (row.decided_by === "host") throw new AppError("DECIDED_ON_HOST");
  if (row.action_digest !== input.action_digest)
    throw new AppError("ACTION_CHANGED");
  if (row.access_status === "paused")
    return blocked(row, "DENIED", "agent_paused");

  const { code, reason } = toCode(row);
  if (code === "PERMIT_ISSUED") throw new AppError("PERMIT_ALREADY_ISSUED");
  if (code !== "READY") return blocked(row, code, reason);

  const { policyVersionId, verdict } = await recheck(context, row);
  const decision = {
    actionRequestId: row.id,
    agentId,
    environmentId,
    policyVersionId,
    matchedLogicalRuleId: verdict.matchedRuleId ?? undefined,
  };
  if (verdict.outcome === "deny") {
    await recordRuntimeDecision(context, {
      ...decision,
      eventType: "authorization.decided",
      decisionCode: "denied_by_rule",
      payload: noteHold(context, row.id, holdOf(verdict)),
    });
    return blocked(row, "DENIED", holdOf(verdict)?.kind ?? "rule");
  }
  // Only an allow counts: anything else since the submit closes it.
  if (verdict.outcome !== "allow")
    return blocked(
      row,
      "INVALIDATED",
      holdOf(verdict) ? "run_changed" : "policy_changed",
    );

  const { response, permit } = await issuePermit(
    context,
    row,
    policyVersionId,
    input,
  );
  // Still holding the windows the decision counted in: nothing came between.
  await reserve(context, row.id, permit, verdict.admission);
  await placeWhenAhead(context, row.id);
  await recordRuntimeDecision(context, {
    ...decision,
    eventType: "authorization.permit_issued",
    decisionCode: "allowed_by_rule",
  });
  return response;
}

/**
 * Labelled as the client's word. It never changes a decision; its first
 * report settles the budgets the permit reserved (success consumes, failure
 * releases, unknown keeps counting), and its measured amounts feed the
 * measured budgets that sum them. `details` never reach a budget.
 */
export async function reportOutcome(
  context: RuntimeContext,
  actionId: string,
  rawInput: unknown,
): Promise<{ recorded: true }> {
  const input = parseInput(reportInput, rawInput);
  const row = await loadAction(context, actionId);
  if (input.permit_id) {
    const [permit]: unknown[] = await context.manager.query(
      `SELECT 1 FROM nodrail.decision_permits
       WHERE workspace_id = $1 AND id = $2 AND action_request_id = $3`,
      [context.workspaceId, input.permit_id, row.id],
    );
    if (!permit) throw new AppError("INVALID_INPUT");
  }
  await touch(context);
  // Only the amounts a budget this action reserved sums; nothing else.
  const reading = await readingFor(
    context,
    { actionId: row.id },
    input.measured ?? [],
    {
      tokens: input.tokens,
      filter: row.decided_by === "host",
    },
  );
  const inserted = await context.manager
    .createQueryBuilder()
    .insert()
    .into(ClientReport)
    .values({
      workspaceId: context.workspaceId,
      installationId: context.installationId,
      actionRequestId: row.id,
      permitId: input.permit_id ?? null,
      clientReportKey: input.report_key,
      outcome: input.outcome,
      detailsSafe: input.details ?? {},
    })
    .orIgnore()
    .returning(["id"])
    .execute();
  // A repeated report changes nothing; a later one with another key finds
  // the reservations settled already: the first word stands.
  if (inserted.raw.length)
    await settle(context, { actionId: row.id }, input.outcome, reading);
  return { recorded: true };
}

export async function recordHeartbeat(
  context: RuntimeContext,
  rawInput: unknown,
): Promise<{ recorded: true }> {
  const input = parseInput(heartbeatInput, rawInput);
  if (input.policy_digest !== undefined)
    await recordPolicyHeartbeat(context, input.policy_digest);
  await touch(context, input.adapter_version);
  return { recorded: true };
}
