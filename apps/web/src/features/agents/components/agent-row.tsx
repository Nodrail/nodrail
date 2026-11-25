import Link from "next/link";
import type { ReactNode } from "react";
import { boxedRow, boxedRowMain } from "@/components/app/item-list";
import { StatusBadge } from "@/components/app/status-badge";
import { focusRing } from "@/components/app/styles";
import { adapterLabel, type AgentListItemDto } from "@/contracts/v1/agents";
import { cn } from "@/lib/utils";
import { agentBadge, checkInSummary, toolLabels } from "../presentation";
import { RowActions } from "@/components/app/row-actions";
import { accessConfirm } from "../access-confirm";
import { AgentAvatar } from "./agent-avatar";

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
              confirm: accessConfirm(workspace, {
                ...agent,
                installations: [agent.installation],
              }),
            }
          : null,
      ]}
    />
  );
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
  const badge = agentBadge(agent.access.status, agent.installation.reporting);
  return (
    <li
      data-slot="agent-row"
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
              {agent.key}
            </strong>
            <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
          </span>
          {agent.description ? <RowMeta>{agent.description}</RowMeta> : null}
          <RowMeta>
            <b className="font-semibold text-body">
              {adapterLabel(agent.installation.adapterKey)}
            </b>
            {agent.tools.length
              ? ` · ${toolLabels(agent.tools).join(", ")}`
              : ""}
            {` · ${checkInSummary(agent.installation.lastSeenAt)}`}
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
    </li>
  );
}
