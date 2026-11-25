import type { Metadata } from "next";
import type { ComponentProps } from "react";
import { Card, CardActions, Disclosure, FactList } from "@/components/app/card";
import { adapterLabel } from "@/contracts/v1/agents";
import { AccessControl } from "@/features/agents/components/access-control";
import {
  AgentHeader,
  AgentNotConnected,
} from "@/features/agents/components/agent-header";
import { AgentPeople } from "@/features/agents/components/agent-people";
import { CredentialPanel } from "@/features/agents/components/credential-panel";
import { loadAgentPage } from "@/features/agents/load";
import { lastCheckIn, toolLabels } from "@/features/agents/presentation";
import { readForPage } from "@/features/shell/load-view";
import { getAgentPeople } from "@/server/modules/team/members";

type Props =
  PageProps<"/app/[workspace]/[environment]/agents/[agent]/settings">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await params).agent} settings` };
}

/** Pausing, last on the page: a step taken rarely and on purpose. */
function PauseCard({
  workspace,
  agent,
}: {
  workspace: string;
  agent: ComponentProps<typeof AccessControl>["agent"];
}) {
  return (
    <Card
      title="Pause this agent"
      description="Blocks its covered checks and closes its open requests until someone resumes it."
    >
      <CardActions>
        <AccessControl workspace={workspace} agent={agent} />
      </CardActions>
    </Card>
  );
}

/**
 * How the agent is set up here: its installation, credential, the people
 * assigned to it and, last, pausing it. A paused agent's Resume is in the
 * heading, on every tab.
 */
export default async function AgentSettingsPage({ params }: Props) {
  const { workspace, environment, agent: agentKey } = await params;
  const page = await loadAgentPage(workspace, environment, agentKey);
  const { agent, environmentName, installation } = page;
  const people = await readForPage(workspace, async (context) =>
    context.capabilities.has("members:manage")
      ? await getAgentPeople(context, agentKey)
      : null,
  );

  return (
    <>
      <AgentHeader page={page} workspace={workspace} current="settings" />
      <div className="grid gap-3">
        {installation ? (
          <Card title="Connection" description="How this agent reaches Nodrail">
            <FactList
              facts={[
                { label: "Agent ID", value: agent.key },
                { label: "Installation", value: installation.name },
                {
                  label: "Runtime integration",
                  value: adapterLabel(installation.adapterKey),
                },
                ...(installation.adapterVersion
                  ? [
                      {
                        label: "Reported version",
                        value: installation.adapterVersion,
                      },
                    ]
                  : []),
                { label: "Environment", value: environmentName },
                {
                  label: "Connected tools",
                  value:
                    toolLabels(agent.tools).join(" · ") || "None observed yet",
                },
                {
                  label: "Last check-in",
                  value: lastCheckIn(installation.lastSeenAt),
                },
              ]}
            />
            <Disclosure summary="Coverage boundary">
              The status above reflects what this configured integration
              reports. It only governs calls routed through it; direct routes
              may not be observed or blocked.
            </Disclosure>
          </Card>
        ) : (
          <AgentNotConnected page={page} />
        )}
        {installation?.credentials ? (
          <CredentialPanel
            workspace={workspace}
            installationId={installation.id}
            installationName={installation.name}
            credentials={installation.credentials}
          />
        ) : null}
        {people ? (
          <AgentPeople
            workspace={workspace}
            agentKey={agent.key}
            people={people}
          />
        ) : null}
        {agent.canManage && agent.access.status === "active" ? (
          <PauseCard workspace={workspace} agent={agent} />
        ) : null}
      </div>
    </>
  );
}
