import "server-only";
import type { z } from "zod";
import type { enrollmentReconcileBody } from "@/contracts/v1/project-apply";
import { AppError, type WorkspaceContext } from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";
import { lockEnvironment } from "@/server/modules/policies/environment-lock";
import { authorizeProject } from "./project-access";

export async function reconcileEnrollment(
  context: WorkspaceContext,
  environment: string,
  {
    project_id,
    machine_id,
    generation,
  }: z.infer<typeof enrollmentReconcileBody>,
) {
  const environmentId = await lockEnvironment(context, environment);
  await authorizeProject(context, project_id, { claim: false });
  const { manager, workspaceId, principal } = context;
  const target = [workspaceId, environmentId, project_id, machine_id];
  const [installation]: {
    id: string;
    agent_id: string;
    owner: string | null;
  }[] = await manager.query(
    `SELECT id, agent_id, enrollment_owner_id AS owner FROM nodrail.installations
       WHERE workspace_id = $1 AND environment_id = $2
         AND enrollment_project_id = $3 AND enrollment_machine_id = $4`,
    target,
  );
  if (installation) {
    if (installation.owner !== principal.userId)
      throw new AppError(
        "FORBIDDEN",
        "Sign in as the user who enrolled this machine.",
      );
    await manager.query(
      "SELECT id FROM nodrail.agents WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [workspaceId, installation.agent_id],
    );
    const [credential]: { id: string; revoked_at: Date | null }[] =
      await manager.query(
        `SELECT id, revoked_at FROM nodrail.installation_credentials
       WHERE workspace_id = $1 AND installation_id = $2 AND public_prefix = $3`,
        [workspaceId, installation.id, generation],
      );
    if (credential) {
      if (!credential.revoked_at) {
        await manager.query(
          `UPDATE nodrail.installation_credentials SET revoked_at = clock_timestamp()
           WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, credential.id],
        );
        await recordAudit(context, {
          eventType: "credential.revoked",
          decisionCode: "credential_revoked",
          agentId: installation.agent_id,
          environmentId,
          payload: { detail: "Machine disconnected" },
        });
      }
      return { status: "revoked" };
    }
  }
  // Fence a delayed apply even when its request has not reached the server yet.
  await manager.query(
    `INSERT INTO nodrail.cancelled_enrollment_generations
       (workspace_id, environment_id, project_id, machine_id, generation)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [...target, generation],
  );
  return { status: "never_activated" };
}
