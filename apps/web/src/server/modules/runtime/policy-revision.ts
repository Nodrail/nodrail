import "server-only";
import type { RuntimeContext } from "@/server/db/context";

type LiveRevision = {
  id: string;
  source_digest: string | null;
  run_policy: unknown;
};

export async function liveRevision({
  manager,
  workspaceId,
  environmentId,
}: RuntimeContext) {
  const [live]: LiveRevision[] = await manager.query(
    `SELECT pv.id, pv.source_digest, pv.run_policy
     FROM nodrail.active_policies ap JOIN nodrail.policy_versions pv
       ON pv.workspace_id = ap.workspace_id AND pv.id = ap.policy_version_id
       AND pv.environment_id = ap.environment_id
     WHERE ap.workspace_id = $1 AND ap.environment_id = $2`,
    [workspaceId, environmentId],
  );
  return live;
}

export const policySkew = (host: string | null, live: string | null) =>
  host === null || live === null ? null : host !== live;

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
