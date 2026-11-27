import "server-only";
import { AppError, type WorkspaceContext } from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";
import { intendedRevisions } from "@/server/modules/inventory/revisions";

export type PolicyWriteContext = WorkspaceContext & {
  reviewedProjectId?: string | null;
};

/** The last repository to publish owns the repository workflow after a console edit. */
async function repositoryProjectId(
  context: WorkspaceContext,
  environmentId: string,
) {
  const [row]: { managed_project_id: string }[] = await context.manager.query(
    `SELECT managed_project_id FROM nodrail.policy_versions
     WHERE workspace_id = $1 AND environment_id = $2 AND managed_project_id IS NOT NULL
     ORDER BY revision DESC LIMIT 1`,
    [context.workspaceId, environmentId],
  );
  return row?.managed_project_id ?? null;
}

export async function readRepositoryProject(
  context: WorkspaceContext,
  environment: string,
) {
  const { id } = await findEnvironment(context, environment);
  const projectId = await repositoryProjectId(context, id);
  if (!projectId) return null;
  const revisions = await intendedRevisions(context, id, projectId);
  return {
    id: projectId,
    name: revisions.get(projectId)?.project ?? projectId,
  };
}

/** Call under the environment lock, before publishing from a console review. */
export async function requireReviewedRepository(
  context: PolicyWriteContext,
  environmentId: string,
) {
  const { reviewedProjectId } = context;
  if (reviewedProjectId === undefined) return;
  if ((await repositoryProjectId(context, environmentId)) !== reviewedProjectId)
    throw new AppError(
      "REPOSITORY_CHANGED",
      "Repository ownership changed. Reload to review the warning before publishing.",
    );
}
