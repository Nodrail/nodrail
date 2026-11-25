import Link from "next/link";
import { EmptyState } from "@/components/app/card";
import { Note } from "@/components/app/note";
import { PageTabs } from "@/components/app/page-tabs";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/shell/components/page-header";
import { timeAgo } from "@/lib/time";
import type { AgentPage } from "../load";
import { accessBadge, reportingBadge } from "../presentation";
import { AccessControl } from "./access-control";
import { AgentAvatar } from "./agent-avatar";

export type AgentTab = "operations" | "rules" | "runs" | "settings";

const tabs: { value: AgentTab; label: string; path: string }[] = [
  { value: "operations", label: "Operations", path: "" },
  { value: "rules", label: "Rules", path: "/rules" },
  { value: "runs", label: "Runs", path: "/runs" },
  { value: "settings", label: "Settings", path: "/settings" },
];

/**
 * Every tab of an agent's page starts here: the agent, how it stands, Resume
 * while it is paused, its waiting requests, then the tabs. Pausing is a step
 * taken rarely and on purpose, so it lives on the Settings tab.
 */
export function AgentHeader({
  page: { agent, base, environmentName, installation },
  workspace,
  current,
}: {
  page: AgentPage;
  workspace: string;
  current: AgentTab;
}) {
  const paused = agent.access.status === "paused";
  const reporting = installation
    ? reportingBadge[installation.reporting]
    : null;
  const agentPath = `${base}/agents/${agent.key}`;
  return (
    <>
      <PageHeader
        title={agent.key}
        purpose={[agent.description, environmentName]
          .filter(Boolean)
          .join(" · ")}
        back={{ href: `${base}/agents`, label: "Back to agents" }}
        lead={<AgentAvatar agentKey={agent.key} />}
        status={
          <span data-tour="agent-status" className="flex flex-wrap gap-2">
            {paused ? (
              <StatusBadge tone={accessBadge.paused.tone}>
                {accessBadge.paused.label}
              </StatusBadge>
            ) : null}
            {reporting ? (
              <StatusBadge tone={reporting.tone}>{reporting.label}</StatusBadge>
            ) : null}
          </span>
        }
        action={
          agent.canManage && paused ? (
            <AccessControl workspace={workspace} agent={agent} />
          ) : null
        }
      />
      {paused && agent.access.pausedAt ? (
        <Note>
          Paused by {agent.access.pausedBy ?? "a former member"}{" "}
          {timeAgo(agent.access.pausedAt)}.
        </Note>
      ) : null}
      <PageTabs
        label="Agent sections"
        tour="agent-tabs"
        current={current}
        tabs={tabs.map(({ value, label, path }) => ({
          value,
          label,
          href: `${agentPath}${path}`,
          tour: `agent-tab-${value}`,
        }))}
      />
    </>
  );
}

/** In place of what an installation would show, when there is none here. */
export function AgentNotConnected({
  page: { agent, base, environmentName },
}: {
  page: AgentPage;
}) {
  return (
    <EmptyState
      title={`Not connected in ${environmentName}`}
      action={
        agent.canManage ? (
          <Button asChild variant="outline">
            <Link href={`${base}/agents/connect?agent=${agent.key}`}>
              Connect in {environmentName}
            </Link>
          </Button>
        ) : null
      }
    >
      This agent has no installation in this environment.
    </EmptyState>
  );
}
