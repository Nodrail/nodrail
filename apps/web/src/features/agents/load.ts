import "server-only";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { appPath } from "@/lib/product-path";
import { getAgent } from "@/server/modules/agents";

/**
 * What every tab of an agent's page needs: the agent (404 when it is not
 * there or not visible to this person), its installation here and names.
 */
export async function loadAgentPage(
  workspace: string,
  environment: string,
  agentKey: string,
) {
  const view = await loadWorkspaceView(workspace);
  const agent = await readForPage(workspace, (context) =>
    getAgent(context, agentKey, environment),
  );
  return {
    view,
    agent,
    base: appPath(workspace, environment),
    environmentName:
      view.environments.find((item) => item.slug === environment)?.name ??
      environment,
    installation:
      agent.installations.find(
        (item) => item.environment.slug === environment,
      ) ?? null,
  };
}

export type AgentPage = Awaited<ReturnType<typeof loadAgentPage>>;
