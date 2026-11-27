import { liveRevision, policySkew } from "./policy-revision";
import type { RuntimeContext } from "@/server/db/runtime-context";

/** Whose credential this is: what `nodrail plan` checks `connect:` against. */
export type RuntimeIdentity = {
  workspace: string;
  environment: string;
  agent: string;
  policy_digest: string | null;
  live_policy_digest: string | null;
  policy_skew: boolean | null;
};

/**
 * The workspace, environment and agent a credential acts for, by slug and
 * key: never an id, a secret or anything about other installations.
 */
export async function readIdentity(
  context: RuntimeContext,
): Promise<RuntimeIdentity> {
  const row = await readRuntimeBinding(context);
  const live = (await liveRevision(context))?.source_digest ?? null;
  return {
    ...row,
    live_policy_digest: live,
    policy_skew: policySkew(row.policy_digest, live),
  };
}

export async function readRuntimeBinding(context: RuntimeContext) {
  const [row]: Omit<RuntimeIdentity, "live_policy_digest" | "policy_skew">[] =
    await context.manager.query(
      `SELECT w.slug AS workspace, e.slug AS environment, a.external_key AS agent,
            i.heartbeat_policy_digest AS policy_digest
     FROM nodrail.installations i
     JOIN nodrail.workspaces w ON w.id = i.workspace_id
     JOIN nodrail.environments e
       ON e.workspace_id = i.workspace_id AND e.id = i.environment_id
     JOIN nodrail.agents a
       ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
     WHERE i.workspace_id = $1 AND i.id = $2`,
      [context.workspaceId, context.installationId],
    );
  return row!;
}
