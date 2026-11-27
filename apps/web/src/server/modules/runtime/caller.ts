import "server-only";
import { AppError, type RuntimeContext } from "@/server/db/context";

type CallerRow = {
  id: string;
  external_key: string;
  access_epoch: number;
  paused_at: Date | null;
  admitted: boolean;
};

/** The credential authenticates the machine. Caller names are reports from it. */
export async function runtimeCaller(
  context: RuntimeContext,
  requested?: string,
) {
  const { manager, workspaceId, installationId, enrollmentProjectId } = context;
  const rows: CallerRow[] = await manager.query(
    `SELECT a.id, a.external_key, a.access_epoch, a.paused_at,
            coalesce((to_jsonb(i)->'enrollment_agent_keys') ? a.external_key, false) AS admitted
     FROM nodrail.installations i
     LEFT JOIN nodrail.active_policies live
       ON live.workspace_id = i.workspace_id AND live.environment_id = i.environment_id
     LEFT JOIN nodrail.policy_versions v
       ON v.workspace_id = live.workspace_id AND v.id = live.policy_version_id
       AND to_jsonb(v)->>'managed_project_id' = to_jsonb(i)->>'enrollment_project_id'
     JOIN nodrail.agents a ON a.workspace_id = i.workspace_id
       AND (a.id = i.agent_id OR (
         a.archived_at IS NULL
         AND to_jsonb(a)->>'managed_project_id' = to_jsonb(i)->>'enrollment_project_id'
         AND ((to_jsonb(i)->'enrollment_agent_keys') ? a.external_key
           OR (to_jsonb(v)->'managed_agent_keys') ? a.external_key)))
     WHERE i.workspace_id = $1 AND i.id = $2
     ORDER BY a.external_key
     FOR SHARE OF a`,
    [workspaceId, installationId],
  );
  const machine = rows.find(({ id }) => id === context.agentId);
  if (!machine) throw new AppError("BUSY");
  const declared = rows.filter(({ id }) => id !== machine.id);
  const identified = declared.find(
    ({ external_key, admitted }) => admitted && external_key === requested,
  );
  const agent = identified ?? machine;
  const accessAgents = identified ? [machine, identified] : rows;
  const paused = accessAgents.filter(({ paused_at }) => paused_at !== null);
  return {
    context: { ...context, agentId: agent.id },
    pausedAgents: paused.map(({ external_key }) => external_key),
    agent: agent.external_key,
    enrolled: !!enrollmentProjectId,
    refusal: paused.length
      ? `Access is paused for ${paused.map(({ external_key }) => external_key).join(", ")}.`
      : null,
    epoch: machine.access_epoch + (identified?.access_epoch ?? 0),
    accessAgents,
  };
}

/** Standalone installations keep their run step labels within their own run. */
export function callerStep<
  T extends { id: string; agent: string } | null | undefined,
>(caller: { agent: string; enrolled: boolean }, step: T) {
  return step && caller.enrolled ? { ...step, agent: caller.agent } : step;
}
