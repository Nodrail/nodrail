import "server-only";
import { AppError, type RuntimeContext } from "@/server/db/context";
import { recordRuntimeDecision } from "@/server/modules/audit";

/** A machine can retire only the enrollment credential authenticating this call. */
export async function disconnectMachine(context: RuntimeContext) {
  if (!context.enrollmentProjectId) throw new AppError("FORBIDDEN");
  const [changed]: [{ id: string }[], number] = await context.manager.query(
    `UPDATE nodrail.installation_credentials SET revoked_at = clock_timestamp()
     WHERE workspace_id = $1 AND id = $2 AND installation_id = $3 AND revoked_at IS NULL
     RETURNING id`,
    [context.workspaceId, context.credentialId, context.installationId],
  );
  if (changed.length)
    await recordRuntimeDecision(context, {
      eventType: "credential.revoked",
      decisionCode: "credential_revoked",
      agentId: context.agentId,
      environmentId: context.environmentId,
      payload: { detail: "Machine disconnected" },
    });
  return { revoked: true };
}
