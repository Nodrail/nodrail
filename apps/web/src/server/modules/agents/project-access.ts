import "server-only";
import type { ProjectAccess } from "@/contracts/v1/project-apply";
import {
  AppError,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";

export async function authorizeProject(
  context: WorkspaceContext,
  projectId: string,
  apply?: { claim: boolean },
) {
  requireCapability(context, "projects:apply");
  const { manager, workspaceId, principal } = context;
  const keys = [workspaceId, projectId, principal.userId];
  if (apply)
    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('enrolled-project:' || $1 || ':' || $2, 0))",
      [workspaceId, projectId],
    );
  if (apply?.claim)
    await manager.query(
      `INSERT INTO nodrail.enrolled_projects (workspace_id, project_id, owner_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      keys,
    );
  const [row]: { allowed: boolean }[] = await manager.query(
    `SELECT (owner_id = $3 OR $3 = ANY(apply_user_ids)) AS allowed
     FROM nodrail.enrolled_projects WHERE workspace_id = $1 AND project_id = $2${apply ? " FOR SHARE" : ""}`,
    keys,
  );
  if (row && !row.allowed && context.role !== "admin")
    throw new AppError(
      "FORBIDDEN",
      `Ask a workspace admin to grant projects:apply for project ${projectId}.`,
    );
}

export async function changeProjectAccess(
  context: WorkspaceContext,
  input: ProjectAccess,
) {
  requireCapability(context, "agents:manage");
  const { manager, workspaceId } = context;
  const project = [workspaceId, input.project_id];
  if (input.action === "bind-agent") {
    const [rows]: [{ id: string }[], number] = await manager.query(
      `UPDATE nodrail.agents SET managed_project_id = $2
       WHERE workspace_id = $1 AND external_key = $3 AND archived_at IS NULL
       RETURNING id`,
      [...project, input.agent],
    );
    if (!rows.length) throw new AppError("NOT_FOUND");
  } else {
    const [rows]: [{ project_id: string }[], number] = await manager.query(
      `UPDATE nodrail.enrolled_projects
       SET apply_user_ids = array_remove(apply_user_ids, $3) || CASE WHEN $4 THEN ARRAY[$3]::uuid[] ELSE '{}' END
       WHERE workspace_id = $1 AND project_id = $2
         AND (NOT $4 OR EXISTS (SELECT 1 FROM nodrail.workspace_memberships
           WHERE workspace_id = $1 AND user_id = $3 AND status = 'active'))
       RETURNING project_id`,
      [...project, input.user_id, input.action === "grant-apply"],
    );
    if (!rows.length) throw new AppError("NOT_FOUND");
  }
  return { ok: true };
}
