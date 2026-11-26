import "server-only";
import { AppError, type RuntimeContext } from "@/server/db/context";

type LiveRevision = {
  id: string;
  source_digest: string | null;
  run_policy: unknown;
  managed_project_id: string | null;
  project: string | null;
};

export async function liveRevision({
  manager,
  workspaceId,
  environmentId,
}: RuntimeContext) {
  const [live]: LiveRevision[] = await manager.query(
    `SELECT pv.id, pv.source_digest, pv.run_policy, pv.managed_project_id, r.project
     FROM nodrail.active_policies ap JOIN nodrail.policy_versions pv
       ON pv.workspace_id = ap.workspace_id AND pv.id = ap.policy_version_id
       AND pv.environment_id = ap.environment_id
     LEFT JOIN nodrail.intended_revisions r ON r.workspace_id = ap.workspace_id
       AND r.environment_id = ap.environment_id AND r.project_id = pv.managed_project_id
     WHERE ap.workspace_id = $1 AND ap.environment_id = $2`,
    [workspaceId, environmentId],
  );
  return live;
}

export const policySkew = (host: string | null, live: string | null) =>
  host === null ? null : host !== live;

export async function recordPolicyHeartbeat(
  context: RuntimeContext,
  digest: string | null,
) {
  const live = await liveRevision(context);
  await context.manager.query(
    `UPDATE nodrail.installations
     SET heartbeat_policy_digest = $3, heartbeat_policy_skew = $4
     WHERE workspace_id = $1 AND id = $2`,
    [
      context.workspaceId,
      context.installationId,
      digest,
      policySkew(digest, live?.source_digest ?? null),
    ],
  );
}

/** A takeover invalidates admission for the previous owner's hosts. */
export async function requirePolicyOwnership(
  context: RuntimeContext,
  live?: LiveRevision,
) {
  if (!context.enrollmentProjectId) return;
  live ??= await liveRevision(context);
  if (live?.managed_project_id === context.enrollmentProjectId) return;
  const owner = live?.project ?? live?.managed_project_id;
  throw new AppError(
    "RULE_CHANGED",
    owner
      ? `Project ${owner} now owns this environment's policy. Use that project's checkout or apply this project to an environment it owns.`
      : "This project's policy no longer owns the environment. Run nodrail plan to review the current policy.",
  );
}

/** A pinned host may keep using a version published for its own project. */
export async function pinnedRevision(
  context: RuntimeContext,
  digest: string,
  workspaceRevision?: string,
) {
  const live = await liveRevision(context);
  if (!context.enrollmentProjectId && live?.source_digest === digest)
    return live;
  const [historical]: Pick<
    LiveRevision,
    "id" | "source_digest" | "run_policy"
  >[] = await context.manager.query(
    `SELECT pv.id, pv.source_digest, pv.run_policy
     FROM nodrail.policy_versions pv
     WHERE pv.workspace_id = $1 AND pv.environment_id = $2 AND pv.source_digest = $3
       AND ($4::uuid IS NULL OR pv.managed_project_id = $4)
       AND ($5::text IS NULL OR pv.managed_revision = $5 OR EXISTS (
         SELECT 1 FROM nodrail.policy_workspace_locks l
         WHERE l.workspace_id = pv.workspace_id AND l.environment_id = pv.environment_id
           AND l.policy_version_id = pv.id AND l.workspace_revision = $5
       ))
     ORDER BY pv.revision DESC LIMIT 1`,
    [
      context.workspaceId,
      context.environmentId,
      digest,
      context.enrollmentProjectId ?? null,
      workspaceRevision ?? null,
    ],
  );
  return historical;
}

/** An enrolled or caller-aware hook is pinned. Legacy direct clients follow live. */
export async function budgetRevision(
  context: RuntimeContext,
  { policy_digest: digest, agent }: { policy_digest: string; agent?: string },
) {
  await requirePolicyOwnership(context);
  if (context.enrollmentProjectId || agent)
    return pinnedRevision(context, digest);
  const live = await liveRevision(context);
  return live?.source_digest === digest ? live : undefined;
}
