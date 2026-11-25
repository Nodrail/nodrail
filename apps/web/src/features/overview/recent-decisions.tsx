import Link from "next/link";
import { cva } from "class-variance-authority";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/app/card";
import { DataEmpty } from "@/components/app/data-table";
import { ItemList, itemMeta } from "@/components/app/item-list";
import { focusRing } from "@/components/app/styles";
import type { ActivityEventDto } from "@/contracts/v1/activity";
import { ActivityLink } from "@/features/activity/components/activity-link";
import { eventTitle, reportLabels } from "@/features/activity/presentation";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  decisionSentence,
  groupDecisions,
  groupTitle,
  type DecisionGroup,
} from "./decisions";

const decisionDot = cva("size-1.75 shrink-0 rounded-full", {
  variants: {
    outcome: {
      allowed: "bg-success/60",
      denied: "bg-destructive/50",
      other: "bg-muted-foreground/45",
    },
  },
});

const dotOutcome = (outcome: ActivityEventDto["outcome"]) =>
  outcome === "allowed" || outcome === "denied" ? outcome : "other";

const rowClass = "flex items-center gap-3.5 rounded-sm px-1 py-2.75";

function When({ at }: { at: string }) {
  return (
    <time
      dateTime={at}
      suppressHydrationWarning
      className="ml-auto shrink-0 text-xs whitespace-nowrap text-muted-foreground"
    >
      {timeAgo(at)}
    </time>
  );
}

/** One decision: the action, then who and why; it opens the event. */
function DecisionRow({
  base,
  event,
}: {
  base: string;
  event: ActivityEventDto;
}) {
  const meta = [
    event.agentKey,
    decisionSentence(event),
    event.latestReport && reportLabels[event.latestReport.outcome],
  ].filter(Boolean);
  return (
    <Link
      href={`${base}/activity?event=${event.id}`}
      data-slot="decision-row"
      className={cn(
        rowClass,
        "group transition-colors hover:bg-muted/50",
        focusRing,
      )}
    >
      <i
        className={decisionDot({ outcome: dotOutcome(event.outcome) })}
        aria-hidden="true"
      />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <b className="text-ui font-semibold text-foreground group-hover:underline">
          {eventTitle(event)}
        </b>
        {event.action ? (
          <code className="ml-1.5 inline-block max-w-full truncate align-bottom text-xs text-body">
            {event.action.resource}
          </code>
        ) : null}
        <small className={itemMeta}>{meta.join(" · ")}</small>
      </span>
      <When at={event.occurredAt} />
    </Link>
  );
}

/** Repeats of one decision, folded into a line that opens to show each. */
function GroupRow({ base, group }: { base: string; group: DecisionGroup }) {
  const [first] = group.events;
  if (!first) return null;
  const actions = [...new Set(group.events.map((event) => eventTitle(event)))];
  const meta = [
    first.agentKey,
    actions.length > 2
      ? `${actions.length} kinds of action`
      : actions.join(", "),
  ].filter(Boolean);
  return (
    <details data-slot="decision-group" className="group/details">
      <summary
        className={cn(
          rowClass,
          "cursor-pointer list-none transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <i
          className={decisionDot({ outcome: dotOutcome(first.outcome) })}
          aria-hidden="true"
        />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <b className="text-ui font-semibold text-foreground">
            {groupTitle(group)}
          </b>
          <small className={itemMeta}>{meta.join(" · ")}</small>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90"
        />
        <When at={first.occurredAt} />
      </summary>
      <ul className="ml-4 divide-y divide-border/70 border-l pl-2 group-open/details:animate-in group-open/details:fade-in-0">
        {group.events.map((event) => (
          <li key={event.id}>
            <DecisionRow base={base} event={event} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The latest decisions, repeats folded together, newest first. */
export function DecisionList({
  base,
  events,
}: {
  base: string;
  events: ActivityEventDto[];
}) {
  return (
    <ItemList data-slot="decision-list">
      {groupDecisions(events).map((group) => {
        const [first, ...repeats] = group.events;
        return first ? (
          <li key={group.id}>
            {repeats.length ? (
              <GroupRow base={base} group={group} />
            ) : (
              <DecisionRow base={base} event={first} />
            )}
          </li>
        ) : null;
      })}
    </ItemList>
  );
}

export function RecentDecisions({
  base,
  events,
}: {
  base: string;
  events: ActivityEventDto[];
}) {
  return (
    <Card
      title="Recent decisions"
      action={<ActivityLink href={`${base}/activity?kind=decisions`} />}
    >
      {events.length ? (
        <DecisionList base={base} events={events} />
      ) : (
        <DataEmpty>No decisions recorded yet.</DataEmpty>
      )}
    </Card>
  );
}
