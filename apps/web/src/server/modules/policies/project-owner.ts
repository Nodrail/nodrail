import "server-only";
import type { WorkspaceContext } from "@/server/db/context";

export async function policyOwner(
  context: Pick<WorkspaceContext, "manager" | "workspaceId">,
  environmentId: string,
) {
  const [owner]: { project_id: string; declarative: boolean }[] =
    await context.manager.query(
      `SELECT managed_project_id AS project_id, managed_agent_keys IS NOT NULL AS declarative
     FROM nodrail.policy_versions
     WHERE workspace_id = $1 AND environment_id = $2 AND managed_project_id IS NOT NULL
     ORDER BY revision DESC LIMIT 1`,
      [context.workspaceId, environmentId],
    );
  return owner ?? null;
}

export async function takeoverHosts(
  context: WorkspaceContext,
  environmentId: string,
  projectId: string,
) {
  const owner = await policyOwner(context, environmentId);
  if (!owner || owner.project_id === projectId) return null;
  const hosts: { id: string; name: string }[] = await context.manager.query(
    `SELECT id, name FROM nodrail.installations
     WHERE workspace_id = $1 AND environment_id = $2 AND enrollment_project_id = $3
       AND archived_at IS NULL
     ORDER BY name`,
    [context.workspaceId, environmentId, owner.project_id],
  );
  return { projectId: owner.project_id, hosts };
}
