import "server-only";
import type { WorkspaceContext } from "@/server/db/context";

export async function rememberPolicyLock(
  context: WorkspaceContext,
  environmentId: string,
  revision: string,
) {
  await context.manager.query(
    `INSERT INTO nodrail.policy_workspace_locks
         (workspace_id, environment_id, policy_version_id, workspace_revision)
       SELECT workspace_id, environment_id, policy_version_id, $3
       FROM nodrail.active_policies
       WHERE workspace_id = $1 AND environment_id = $2
       ON CONFLICT DO NOTHING`,
    [context.workspaceId, environmentId, revision],
  );
}

export async function hasPolicyLock(
  context: WorkspaceContext,
  environmentId: string,
  revision: string,
) {
  const [pin]: { current: boolean }[] = await context.manager.query(
    `SELECT EXISTS (
       SELECT 1 FROM nodrail.active_policies a
       JOIN nodrail.policy_workspace_locks l USING (workspace_id, environment_id, policy_version_id)
       WHERE a.workspace_id = $1 AND a.environment_id = $2 AND l.workspace_revision = $3
     ) AS current`,
    [context.workspaceId, environmentId, revision],
  );
  return pin?.current ?? false;
}
