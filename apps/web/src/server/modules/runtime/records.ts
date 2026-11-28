import "server-only";
import { actionDigest, type ActionDescriptor } from "@nodrail/sdk/protocol";
import { REQUEST_TTL_MINUTES } from "@/contracts/v1/requests";
import type { RunHoldDto } from "@/contracts/v1/runs";
import { type RuntimeContext } from "@/server/db/context";
import { digestSecret } from "@/server/security/secrets";
import { changeOf } from "@/server/modules/runs/change";
import type { Place } from "@/server/modules/runs/history";
import { nextSeq } from "@/server/modules/runs/steps";
import type { InitialEvaluation } from "./decide";

// What a submitted action leaves behind: its request, and what was seen.

export const requestExpiry = `clock_timestamp() + make_interval(mins => ${REQUEST_TTL_MINUTES})`;

/** What a permission was last seen as: allowed, denied, or covered by no rule. */
export type ObservedOutcome =
  "allowed_by_rule" | "denied_by_rule" | "unknown_blocked";

export const observedOutcome = (
  evaluation: InitialEvaluation,
  unmatched: boolean,
): ObservedOutcome =>
  evaluation === "ready"
    ? "allowed_by_rule"
    : unmatched
      ? "unknown_blocked"
      : "denied_by_rule";

export const fingerprintOf = ({
  tool,
  operation,
  resource,
}: ActionDescriptor) =>
  digestSecret(`${tool}.${operation}\n${resource.kind}\n${resource.id}`);

export function observe(
  context: RuntimeContext,
  descriptor: ActionDescriptor,
  actionId: string,
  outcome: ObservedOutcome,
) {
  const { tool, operation, resource } = descriptor;
  return context.manager.query(
    `INSERT INTO nodrail.observed_permissions
       (workspace_id, installation_id, permission_fingerprint, tool_key,
        operation_key, resource_kind, resource_label, last_outcome,
        last_action_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (workspace_id, installation_id, permission_fingerprint) DO UPDATE
     SET attempt_count = nodrail.observed_permissions.attempt_count + 1,
         last_outcome = EXCLUDED.last_outcome,
         last_action_request_id = EXCLUDED.last_action_request_id,
         last_seen_at = clock_timestamp()`,
    [
      context.workspaceId,
      context.installationId,
      fingerprintOf(descriptor),
      tool,
      operation,
      resource.kind,
      resource.id,
      outcome,
      actionId,
    ],
  );
}

/**
 * A gate or budget held an action back: logged for operators, and carried
 * by its audit event so Activity can name it.
 */
export function noteHold(
  { workspaceId }: RuntimeContext,
  actionId: string,
  held: RunHoldDto | null,
) {
  if (!held) return undefined;
  const hold = { kind: held.kind, id: held.id, name: held.name };
  console.info("Run hold", { workspaceId, actionId, ...hold });
  return { hold };
}

/**
 * A change takes its place in the run when it goes ahead, not when it was
 * asked for: a check that finished before its permit never saw it.
 * Called holding the run, as the permit's decision does.
 */
export function placeWhenAhead(
  { manager, workspaceId }: RuntimeContext,
  id: string,
) {
  return manager.query(
    `UPDATE nodrail.action_requests SET run_seq = ${nextSeq}
     WHERE workspace_id = $1 AND id = $2 AND run_change`,
    [workspaceId, id],
  );
}

export type NewRequest = {
  id: string;
  key: string;
  adapterVersion: string | undefined;
  descriptor: ActionDescriptor;
  digest: string;
  pauseReplayDigest?: string;
  policyVersionId: string;
  accessEpoch: number;
  evaluation: InitialEvaluation;
  place: Place | null;
  hold: RunHoldDto | null;
  /** A call the hook decided on its host: what Cloud can't work out itself. */
  host?: HostFacts;
};

export type HostFacts = {
  policyDigest: string | null;
  policySkew: boolean | null;
  rule: { id: string; name?: string } | null;
  reason: string | null;
  decidedAt: string;
  bodyDigest: string;
};

/** `decided_by` and the host's facts; Cloud's own rows carry none. */
function hostColumns(host: HostFacts | undefined) {
  if (!host) return ["server", null, null, null, null, null, null, null];
  const { rule } = host;
  return [
    "host",
    host.policyDigest,
    rule ? rule.id : null,
    rule?.name ?? null,
    host.reason,
    host.decidedAt,
    host.bodyDigest,
    host.policySkew,
  ];
}

/** False when the same key won a race, so the caller replays that one. */
export async function insertRequest(
  context: RuntimeContext,
  request: NewRequest,
) {
  const { workspaceId, installationId, agentId, environmentId } = context;
  const { id, descriptor, digest, place } = request;
  const inserted: unknown[] = await context.manager.query(
    `INSERT INTO nodrail.action_requests
       (id, workspace_id, installation_id, agent_id, environment_id,
        idempotency_key, adapter_version, tool_key, operation_key, resource_kind,
        resource_id, params_safe, permission_fingerprint, descriptor_digest,
        action_digest, initial_policy_version_id, access_epoch,
        initial_evaluation, run_id, step_key, run_hold, run_change,
        decided_by, policy_digest, host_rule_id, host_rule_name, host_reason,
        host_decided_at, body_digest, policy_skew, pause_replay_digest, run_seq, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14,
             $15, $16, $17, $18, $19, $20, $21::jsonb, $22, $23, $24, $25, $26,
             $27, $28::timestamptz, $29, $30, $31,
             CASE WHEN $19::uuid IS NULL THEN NULL ELSE ${nextSeq} END,
             ${requestExpiry})
     ON CONFLICT (workspace_id, installation_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [
      id,
      workspaceId,
      installationId,
      agentId,
      environmentId,
      request.key,
      request.adapterVersion ?? null,
      descriptor.tool,
      descriptor.operation,
      descriptor.resource.kind,
      descriptor.resource.id,
      JSON.stringify(descriptor.params),
      fingerprintOf(descriptor),
      digest,
      actionDigest(id, digest),
      request.policyVersionId,
      request.accessEpoch,
      request.evaluation,
      place?.runId ?? null,
      place?.step?.id ?? null,
      request.hold ? JSON.stringify(request.hold) : null,
      place ? request.accessEpoch > 0 && changeOf(descriptor) : null,
      ...hostColumns(request.host),
      request.pauseReplayDigest ?? null,
    ],
  );
  return inserted.length > 0;
}
