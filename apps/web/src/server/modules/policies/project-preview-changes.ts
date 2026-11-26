import "server-only";
import type { Declarations, ProjectApply } from "@/contracts/v1/project-apply";
import type { PolicyFilePreviewDto } from "@/contracts/v1/policies";
import type { WorkspaceContext } from "@/server/db/context";
import { liveSource, nothingToPublish } from "./managed";
import { hasPolicyLock } from "./policy-workspace-lock";

export async function projectPreviewChanges(
  context: WorkspaceContext,
  environmentId: string,
  {
    declarations,
    intended,
    text,
    policyCounts,
    changedAgents,
  }: {
    declarations: Declarations;
    intended?: ProjectApply["intended"];
    text: unknown;
    policyCounts: NonNullable<PolicyFilePreviewDto["policyCounts"]>;
    changedAgents: string[];
  },
) {
  const agentKeys = declarations.agents
    .map(({ key }) => key)
    .sort((a, b) => a.localeCompare(b));
  const live = await liveSource(context, environmentId);
  const liveKeys = live.managed_agent_keys ?? [];
  const agentChanges = {
    added: agentKeys.filter((key) => !liveKeys.includes(key)),
    changed: changedAgents
      .map((name) => name.slice("agent ".length))
      .filter((key) => liveKeys.includes(key)),
    removed: liveKeys.filter((key) => !agentKeys.includes(key)),
  };
  if (!intended || typeof text !== "string")
    return { policyCounts, agentChanges };

  const publishesPolicy = !(await nothingToPublish(
    context,
    environmentId,
    policyCounts,
    {
      managed: intended,
      source: text,
      agentKeys,
    },
  ));
  const workspaceLockCurrent =
    !publishesPolicy &&
    (live.managed?.revision === intended.revision ||
      (await hasPolicyLock(context, environmentId, intended.revision)));
  return { policyCounts, agentChanges, publishesPolicy, workspaceLockCurrent };
}
