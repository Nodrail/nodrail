import type { Metadata } from "next";
import { Card } from "@/components/app/card";
import { FormHint } from "@/components/app/note";
import { ActivityLink } from "@/features/activity/components/activity-link";
import {
  AgentHeader,
  AgentNotConnected,
} from "@/features/agents/components/agent-header";
import { ObservedActions } from "@/features/agents/components/observed-actions";
import { loadAgentPage } from "@/features/agents/load";

type Props = PageProps<"/app/[workspace]/[environment]/agents/[agent]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).agent };
}

/**
 * An agent's first tab: each operation it asks for, once, with how it was
 * last decided. Every event behind them is in Activity, a link away, so the
 * same actions are never listed twice.
 */
export default async function AgentPage({ params }: Props) {
  const { workspace, environment, agent: agentKey } = await params;
  const page = await loadAgentPage(workspace, environment, agentKey);
  const { agent, base, installation } = page;
  const activityPath = `${base}/activity?agent=${encodeURIComponent(agent.key)}`;

  return (
    <>
      <AgentHeader page={page} workspace={workspace} current="operations" />
      <div className="grid gap-3">
        {installation ? null : <AgentNotConnected page={page} />}
        <div data-tour="agent-operations">
          <Card
            title="Operations this agent uses"
            description="What its integration asked Nodrail about, and the last decision on each"
          >
            {agent.observedActions.length ? (
              <ObservedActions
                actions={agent.observedActions}
                activityHref={(operation) =>
                  `${activityPath}&q=${encodeURIComponent(operation)}`
                }
              />
            ) : (
              <FormHint>
                Nothing yet. Its operations show here once it asks before
                acting.
              </FormHint>
            )}
            <FormHint>
              Only what reaches Nodrail through the integration is listed, not
              every permission the agent may have.
            </FormHint>
          </Card>
          <p className="mt-2.5">
            <ActivityLink href={activityPath} />
          </p>
        </div>
      </div>
    </>
  );
}
