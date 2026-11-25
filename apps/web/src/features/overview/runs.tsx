import Link from "next/link";
import { Card } from "@/components/app/card";
import { DataEmpty } from "@/components/app/data-table";
import { focusRing } from "@/components/app/styles";
import { StatusBadge } from "@/components/app/status-badge";
import type { RunSummaryDto } from "@/contracts/v1/runs";
import { runStatuses } from "@/features/runs/components/runs-table";
import { runPath } from "@/features/runs/presentation";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { ItemList } from "@/components/app/item-list";
import { SectionHeading } from "@/components/app/section-heading";
import { holdLabel } from "@/contracts/v1/glossary";
import { ActivityLink } from "@/features/activity/components/activity-link";

/** What holds a run, in a few words: "waiting for qa and reviewer". */
export function holdText(holding: NonNullable<RunSummaryDto["holding"]>) {
  if (holding.kind === "budget") return holdLabel("budget", holding.name);
  const agents = [...new Set(holding.missing.map((item) => item.agent))];
  if (!agents.length) return holdLabel("gate", holding.name);
  const last = agents.pop();
  return `waiting for ${agents.length ? `${agents.join(", ")} and ${last}` : last}`;
}

const runLink = cn(
  "min-w-0 truncate rounded-sm font-mono text-xs font-semibold text-foreground hover:underline",
  focusRing,
);

/** Runs a gate or budget holds, and what each still needs. */
export function HeldRuns({
  base,
  runs,
}: {
  base: string;
  runs: RunSummaryDto[];
}) {
  if (!runs.length) return null;
  return (
    <div data-slot="held-runs">
      <SectionHeading
        as="h3"
        title="Runs a gate or budget stopped"
        action={
          <ActivityLink href={`${base}/activity?view=runs&outcome=held`} />
        }
      />
      <ul className="stagger grid gap-1.5">
        {runs.map((run) => (
          <li
            key={run.id}
            data-slot="held-run"
            className="flex items-baseline gap-2 text-ui"
          >
            <Link
              href={runPath(base, run.id)}
              title={run.key}
              className={runLink}
            >
              {run.key}
            </Link>
            <span className="min-w-0 truncate text-muted-foreground">
              {run.holding ? holdText(run.holding) : "held"}
            </span>
            <time
              dateTime={run.lastActivityAt}
              suppressHydrationWarning
              className="ml-auto shrink-0 text-xs text-muted-foreground"
            >
              {timeAgo(run.lastActivityAt)}
            </time>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Runs active in the last day and where each stands. */
export function ActiveRuns({
  base,
  runs,
}: {
  base: string;
  runs: RunSummaryDto[];
}) {
  return (
    <Card
      title="Active runs"
      action={<ActivityLink href={`${base}/activity?view=runs`} />}
    >
      {runs.length ? (
        <ItemList data-slot="active-runs">
          {runs.map((run) => {
            const status = runStatuses[run.status];
            return (
              <li
                key={run.id}
                data-slot="active-run"
                className="flex items-center gap-3 px-1 py-2.75 phone:flex-wrap"
              >
                <span className="grid min-w-0 flex-1 gap-0.75">
                  <Link
                    href={runPath(base, run.id)}
                    className={cn(runLink, "truncate")}
                  >
                    {run.key}
                  </Link>
                  <small className="truncate text-xs text-muted-foreground">
                    {[run.agentKey, run.holding ? holdText(run.holding) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                <time
                  dateTime={run.lastActivityAt}
                  suppressHydrationWarning
                  className="w-20 shrink-0 text-right text-xs text-muted-foreground phone:w-auto"
                >
                  {timeAgo(run.lastActivityAt)}
                </time>
              </li>
            );
          })}
        </ItemList>
      ) : (
        <DataEmpty>No runs in the last 24 hours.</DataEmpty>
      )}
    </Card>
  );
}
