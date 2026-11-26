import "server-only";
import type { Machine } from "@/contracts/v1/project-apply";
import type { WorkspaceContext } from "@/server/db/context";
import { enrollmentStatus } from "@/server/modules/agents/enrollment";
import { authorizeProject } from "@/server/modules/agents/project-access";
import { findEnvironment } from "@/server/modules/workspaces";

export async function enrollmentPreflight(
  context: WorkspaceContext,
  environment: string,
  projectId: string,
  machine: Machine,
) {
  if (context.capabilities.has("projects:apply"))
    await authorizeProject(context, projectId);
  const { id: environmentId } = await findEnvironment(context, environment);
  const [live]: { keys: string[] }[] = await context.manager.query(
    `SELECT v.managed_agent_keys AS keys
     FROM nodrail.active_policies a
     JOIN nodrail.policy_versions v
       ON v.workspace_id = a.workspace_id AND v.environment_id = a.environment_id AND v.id = a.policy_version_id
     WHERE a.workspace_id = $1 AND a.environment_id = $2 AND v.managed_project_id = $3
       AND v.managed_agent_keys IS NOT NULL`,
    [context.workspaceId, environmentId, projectId],
  );
  return enrollmentStatus(
    context,
    { projectId, environmentId },
    machine,
    live?.keys,
  );
}
