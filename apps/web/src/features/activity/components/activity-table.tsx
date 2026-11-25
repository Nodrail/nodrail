"use client";

import type { MouseEvent } from "react";
import { RowActions } from "@/components/app/row-actions";
import { StatusBadge } from "@/components/app/status-badge";
import type { ActivityEventDto } from "@/contracts/v1/activity";
import { HostBadge } from "@/features/runs/components/host-badge";
import { runPath } from "@/features/runs/presentation";
import { timeAgo } from "@/lib/time";
import {
  eventTitle,
  mismatchLabel,
  outcomeTones,
  reportLabels,
} from "../presentation";
import {
  DataActionsCell,
  DataActionsHeading,
  DataTable,
  DataTitleLink,
} from "@/components/app/data-table";

/** What an event's "⋯" menu needs from the page. */
export type EventMenu = {
  /** The environment's address. */
  base: string;
  /** Activity, with the current filters but only this agent. */
  agentHref: (agentKey: string) => string;
};

/**
 * An event's menu: its details, the run behind it, the same list for its
 * agent alone, and its request ID.
 */
function EventActions({
  event,
  href,
  onOpen,
  menu,
}: {
  event: ActivityEventDto;
  href: string;
  onOpen?: () => void;
  menu: EventMenu;
}) {
  const { base } = menu;
  const action = event.action;
  return (
    <RowActions
      name={eventTitle(event)}
      tour="activity-more"
      items={[
        onOpen
          ? { label: "View details", onSelect: onOpen }
          : { label: "View details", href },
        action?.run
          ? {
              label: `Open run ${action.run.key}`,
              href: runPath(base, action.run.id),
            }
          : null,
        "separator",
        event.agentKey
          ? {
              label: "Filter by this agent",
              href: menu.agentHref(event.agentKey),
            }
          : null,
        "separator",
        action
          ? {
              label: "Copy request ID",
              copy: action.reference,
              copied: `Copied ${action.reference}.`,
            }
          : null,
      ]}
    />
  );
}

function Subject({ event }: { event: ActivityEventDto }) {
  const parts = event.action
    ? [event.agentKey, event.action.installationName, event.action.reference]
    : [event.rule || event.subject ? event.agentKey : null];
  const text = parts.filter(Boolean).join(" · ");
  return text ? <small>{text}</small> : null;
}

function resourceText(event: ActivityEventDto) {
  if (event.action) return event.action.resource;
  if (event.detail) return event.detail;
  return event.rule?.revision ? `Policy set v${event.rule.revision}` : null;
}

function ReportCell({ event }: { event: ActivityEventDto }) {
  return (
    <td data-blank={event.action ? undefined : true}>
      {event.latestReport ? (
        <>
          {reportLabels[event.latestReport.outcome]}
          <small>From integration</small>
          {event.latestReport.mismatch ? (
            <span data-slot="report-mismatch" className="mt-1 block">
              <StatusBadge tone="danger">{mismatchLabel}</StatusBadge>
            </span>
          ) : null}
        </>
      ) : event.action ? (
        "Not reported"
      ) : (
        "—"
      )}
    </td>
  );
}

/** A modified click keeps the browser's own way of opening a link. */
const plainClick = (event: MouseEvent) =>
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/**
 * Events, newest first. The title is a link to the event's panel, and a
 * click anywhere else on the row opens it too; with `menu`, each row ends in
 * a "⋯" menu of what to do next.
 */
export function ActivityTable({
  items,
  hrefFor,
  onOpen,
  menu,
}: {
  items: ActivityEventDto[];
  hrefFor: (id: string) => string;
  onOpen?: (id: string) => void;
  menu?: EventMenu;
}) {
  return (
    <DataTable aria-label="Events" data-tour="activity-table">
      <thead>
        <tr>
          <th scope="col">Request</th>
          <th scope="col">Resource</th>
          <th scope="col">Decision</th>
          <th scope="col">Client report</th>
          <th scope="col">Time</th>
          {menu ? <DataActionsHeading /> : null}
        </tr>
      </thead>
      <tbody className="stagger">
        {items.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            href={hrefFor(event.id)}
            onOpen={onOpen ? () => onOpen(event.id) : undefined}
            menu={menu}
          />
        ))}
      </tbody>
    </DataTable>
  );
}

function EventRow({
  event,
  href,
  onOpen,
  menu,
}: {
  event: ActivityEventDto;
  href: string;
  onOpen?: () => void;
  menu?: EventMenu;
}) {
  return (
    <tr
      data-slot="activity-row"
      className={onOpen ? "cursor-pointer" : undefined}
      onClick={(click) => {
        if (onOpen && !(click.target as Element).closest("a, button")) onOpen();
      }}
    >
      <td>
        <DataTitleLink
          href={href}
          scroll={false}
          onClick={(click) => {
            if (!onOpen || !plainClick(click)) return;
            click.preventDefault();
            onOpen();
          }}
        >
          {eventTitle(event)}
        </DataTitleLink>
        <Subject event={event} />
      </td>
      <td data-blank={resourceText(event) ? undefined : true}>
        {resourceText(event) ?? "—"}
      </td>
      <td>
        <StatusBadge tone={outcomeTones[event.outcome]}>
          {event.label}
        </StatusBadge>
        <HostBadge host={event.host} />
      </td>
      <ReportCell event={event} />
      <td>
        <time dateTime={event.occurredAt} suppressHydrationWarning>
          {timeAgo(event.occurredAt)}
        </time>
      </td>
      {menu ? (
        <DataActionsCell>
          <EventActions event={event} href={href} onOpen={onOpen} menu={menu} />
        </DataActionsCell>
      ) : null}
    </tr>
  );
}
