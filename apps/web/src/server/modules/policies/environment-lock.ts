import "server-only";
import { requireCapability, type WorkspaceContext } from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * The environment, locked until the transaction ends, for someone who manages
 * its policies: two publishes never start from the same version.
 */
export async function lockEnvironment(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  requireCapability(context, "policies:write");
  const { manager, workspaceId } = context;
  const { id } = await findEnvironment(context, environmentSlug);
  await manager.query(
    `SELECT 1 FROM nodrail.environments
     WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, id],
  );
  return id;
}
