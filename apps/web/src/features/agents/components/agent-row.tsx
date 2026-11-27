import Link from "next/link";
import type { ReactNode } from "react";
import { boxedRow, boxedRowMain } from "@/components/app/item-list";
import { StatusBadge } from "@/components/app/status-badge";
import { focusRing } from "@/components/app/styles";
import { adapterLabel, type AgentListItemDto } from "@/contracts/v1/agents";
import { cn } from "@/lib/utils";
import {
  agentBadge,
  agentProject,
  checkInSummary,
  toolLabels,
} from "../presentation";
import { RowActions } from "@/components/app/row-actions";
import { accessConfirm } from "../access-confirm";
import { AgentAvatar } from "./agent-avatar";
import { AgentMachines } from "./agent-machines";

function RowMeta({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-xs text-muted-foreground">{children}</span>
  );
}

/**
 * The agent's "⋯" menu: its page, its activity and the rules that apply to it,
 * and for people who manage agents, Pause or Resume after a confirmation.
 */
function AgentActions({
  workspace,
  base,
  agent,
  canManage,
}: {
  workspace: string;
  base: string;
  agent: AgentListItemDto;
  canManage: boolean;
}) {
  const machine = agent.installations.find(
    ({ machineKey }) => machineKey === agent.key,
  );
  const key = encodeURIComponent(agent.key);
  const paused = agent.access.status === "paused";
  return (
    <RowActions
      name={agent.key}
      items={[
        { label: "Open", href: `${base}/agents/${key}` },
        { label: "View in Activity", href: `${base}/activity?agent=${key}` },
        { label: "Rules that apply", href: `${base}/policies?agent=${key}` },
        "separator",
        canManage
          ? {
              label: paused ? "Resume…" : "Pause…",
              destructive: !paused,
              confirm: accessConfirm(
                workspace,
                agent,
                machine
                  ? { machine: machine.name }
                  : { machinesHref: `${base}/agents#machines` },
              ),
            }
          : null,
      ]}
    />
  );
}

function rowIdentity(agent: AgentListItemDto) {
  const { installation } = agent;
  const fallback = installation?.machineKey === agent.key;
  return {
    name: fallback ? `Unidentified callers on ${installation.name}` : agent.key,
    badge:
      fallback && installation.disconnected
        ? { tone: "neutral" as const, label: "Disconnected" }
        : agentBadge(
            agent.access.status,
            installation?.reporting ?? "never_reported",
          ),
  };
}

/** One agent in the list: a link to its page, with its waiting requests beside it. */
export function AgentRow({
  agent,
  href,
  workspace,
  base,
  canManage,
}: {
  agent: AgentListItemDto;
  href: string;
  workspace: string;
  /** The environment's address, for the menu's links. */
  base: string;
  canManage: boolean;
}) {
  const { installation } = agent;
  const { name, badge } = rowIdentity(agent);
  const project = agentProject(agent);
  return (
    <li data-slot="agent-row" className="min-w-0">
      <div
        className={cn(
          boxedRow,
          "transition-[border-color,transform,box-shadow] duration-150 focus-within:border-input hover:-translate-y-px hover:border-input hover:shadow-sm",
        )}
      >
        <Link
          href={href}
          className={cn(boxedRowMain, "rounded-lg phone:pr-12", focusRing)}
        >
          <AgentAvatar agentKey={agent.key} />
          <span className="grid min-w-0 gap-1">
            <span className="flex min-w-0 items-center gap-2">
              <strong className="truncate font-display text-sm font-bold text-foreground">
                {name}
              </strong>
              <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
            </span>
            {project ? <RowMeta>{project}</RowMeta> : null}
            {agent.description ? <RowMeta>{agent.description}</RowMeta> : null}
            <RowMeta>
              {installation ? (
                <b className="font-semibold text-body">
                  {adapterLabel(installation.adapterKey)}
                  {" · "}
                </b>
              ) : null}
              {agent.tools.length
                ? `${toolLabels(agent.tools).join(", ")} · `
                : ""}
              {checkInSummary(installation?.lastSeenAt ?? null)}
            </RowMeta>
          </span>
        </Link>
        <span className="pr-2.5 phone:absolute phone:top-2.5 phone:right-2 phone:pr-0">
          <AgentActions
            workspace={workspace}
            base={base}
            agent={agent}
            canManage={canManage}
          />
        </span>
      </div>
      {agent.project && agent.installations.length ? (
        <AgentMachines
          machines={agent.installations}
          workspace={workspace}
          canManage={canManage}
        />
      ) : null}
    </li>
  );
}
