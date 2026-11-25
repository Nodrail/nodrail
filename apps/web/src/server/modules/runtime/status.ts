import "server-only";
import type { ActionStatus } from "@nodrail/client/protocol";
import { z } from "zod";
import { requestReference } from "@/contracts/v1/requests";
import type { RunHoldDto } from "@/contracts/v1/runs";
import { AppError, parseRows, type RuntimeContext } from "@/server/db/context";
import { actionColumns } from "@/server/modules/authorizations/action-columns";

const statusRow = z.object({
  id: z.uuid(),
  descriptor_digest: z.string(),
  action_digest: z.string(),
  initial_evaluation: z.string(),
  access_epoch: z.number(),
  current_epoch: z.number(),
  access_status: z.enum(["active", "paused"]),
  ...actionColumns,
  expires_at: z.date(),
  expired: z.boolean(),
  permit_id: z.uuid().nullable(),
  run_hold: z.custom<RunHoldDto>().nullable(),
  no_rule: z.boolean(),
  decided_by: z.enum(["server", "host"]),
  policy_skew: z.boolean().nullable(),
});
export type StatusRow = z.infer<typeof statusRow>;

const statusSelect = `
  SELECT ar.id, ar.descriptor_digest, ar.action_digest, ar.initial_evaluation,
         ar.access_epoch, a.access_epoch AS current_epoch, a.access_status,
         ar.tool_key, ar.operation_key, ar.resource_kind, ar.resource_id,
         ar.params_safe, ar.expires_at,
         ar.expires_at <= clock_timestamp() AS expired, ar.run_hold,
         ar.decided_by, ar.policy_skew,
         -- Denied because no rule covered it, as its audit event says.
         EXISTS (SELECT 1 FROM nodrail.audit_events e
                 WHERE e.workspace_id = ar.workspace_id
                   AND e.action_request_id = ar.id
                   AND e.decision_code = 'denied_no_rule') AS no_rule,
         (SELECT p.id FROM nodrail.decision_permits p
          WHERE p.workspace_id = ar.workspace_id
            AND p.action_request_id = ar.id) AS permit_id
  FROM nodrail.action_requests ar
  JOIN nodrail.agents a ON a.workspace_id = ar.workspace_id AND a.id = ar.agent_id`;

const ownAction = `ar.workspace_id = $1 AND ar.installation_id = $2`;

export function toCode(row: StatusRow): Pick<ActionStatus, "code" | "reason"> {
  const blocked = (
    code: ActionStatus["code"],
    reason: string | null = null,
  ) => ({
    code,
    reason,
  });
  if (row.permit_id) return blocked("PERMIT_ISSUED");
  if (row.initial_evaluation === "denied")
    return blocked(
      "DENIED",
      row.run_hold?.kind ?? (row.no_rule ? "no_rule" : "rule"),
    );
  if (row.expired) return blocked("EXPIRED");
  if (row.access_epoch !== row.current_epoch)
    return blocked("INVALIDATED", "agent_paused");
  return blocked("READY");
}

export function toStatus(
  row: StatusRow,
  context: RuntimeContext,
): ActionStatus & { policy_skew?: boolean | null } {
  return {
    ...toCode(row),
    ...(row.decided_by === "host" ? { policy_skew: row.policy_skew } : {}),
    action_id: row.id,
    installation_id: context.installationId,
    permit_id: row.permit_id,
    descriptor_digest: row.descriptor_digest,
    action_digest: row.action_digest,
    reference: requestReference(row.id),
    expires_at: row.expires_at.toISOString(),
  };
}

/** Only the installation that submitted an action can see it. */
export async function loadAction(
  context: RuntimeContext,
  actionId: string,
): Promise<StatusRow> {
  if (!z.uuid().safeParse(actionId).success) throw new AppError("NOT_FOUND");
  const [row] = parseRows(
    statusRow,
    await context.manager.query(
      `${statusSelect} WHERE ${ownAction} AND ar.id = $3`,
      [context.workspaceId, context.installationId, actionId],
    ),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function findByKey(context: RuntimeContext, key: string) {
  const [row] = parseRows(
    statusRow,
    await context.manager.query(
      `${statusSelect} WHERE ${ownAction} AND ar.idempotency_key = $3`,
      [context.workspaceId, context.installationId, key],
    ),
  );
  return row;
}
