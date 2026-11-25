import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/components/app/styles";
import { StatusBadge } from "@/components/app/status-badge";
import type { Tone } from "@/components/app/tones";
import { REPORTING_WINDOW_MINUTES } from "@/contracts/v1/agents";
import type { UsageDto, UsageState } from "@/contracts/v1/billing";
import { problemCount, type HealthDto } from "@/contracts/v1/health";
import { count } from "@/contracts/v1/usage-alerts";
import type { PlanUsageDto } from "@/contracts/v1/overview";
import { runPath } from "@/features/runs/presentation";
import { plural } from "@/lib/text";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Figure, TileLabel, linkedTileClass, tileClass } from "./section";

/** "a, b and 2 more": a few names, then how many others. */
export function someNames(names: string[], shown = 3) {
  const unique = [...new Set(names)];
  if (unique.length <= shown) return unique.join(", ");
  return `${unique.slice(0, shown).join(", ")} and ${unique.length - shown} more`;
}

function TileTop({
  label,
  badge,
}: {
  label: string;
  badge?: { tone: Tone; text: string } | null;
}) {
  return (
    <span className="flex items-center justify-between gap-2">
      <TileLabel>{label}</TileLabel>
      {badge ? <StatusBadge tone={badge.tone}>{badge.text}</StatusBadge> : null}
    </span>
  );
}

const detailClass = "mt-1.5 text-xs leading-normal text-muted-foreground";

/** How many agents reported recently, naming the silent and the paused. */
function AgentsTile({ base, health }: { base: string; health: HealthDto }) {
  const { agents, silent, paused } = health;
  const quiet = silent.length + paused.length > 0;
  return (
    <Link
      href={`${base}/agents`}
      data-slot="health-tile"
      data-tile="agents"
      className={linkedTileClass}
    >
      <TileTop
        label="Agents reporting"
        badge={
          quiet
            ? { tone: "warning", text: "Needs a look" }
            : { tone: "success", text: "All reporting" }
        }
      />
      <Figure value={`${agents.reporting} of ${agents.connected}`} />
      <span className={detailClass}>
        {silent.length ? (
          <span className="block">
            Silent: {someNames(silent.map((item) => item.agentKey))}
          </span>
        ) : null}
        {paused.length ? (
          <span className="block">
            Paused: {someNames(paused.map((item) => item.agentKey))}
          </span>
        ) : null}
        {silent.length ? (
          <span className="block">
            Silent means no check-in in the last {REPORTING_WINDOW_MINUTES}{" "}
            minutes.
          </span>
        ) : null}
        {quiet
          ? null
          : `Every agent checked in within ${REPORTING_WINDOW_MINUTES} minutes.`}
      </span>
    </Link>
  );
}

const worst = (states: UsageState[]): UsageState =>
  states.includes("reached")
    ? "reached"
    : states.includes("near")
      ? "near"
      : "ok";

const usageBadges: Record<UsageState, { tone: Tone; text: string } | null> = {
  ok: null,
  near: { tone: "warning", text: "Over 80%" },
  reached: { tone: "danger", text: "Limit reached" },
};

const percentOf = ({ used, limit }: UsageDto) =>
  limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;

/**
 * The share used, as people read it: "<1%" once anything is used but too
 * little to round to 1%, so 4 of 1,000 never reads as nothing used.
 */
export const usageShare = (usage: UsageDto) => {
  const percent = percentOf(usage);
  return percent === 0 && usage.used > 0 ? "<1%" : `${percent}%`;
};

/** One counter as a thin bar: "Agent actions 720 / 1,000". */
function UsageBar({ label, usage }: { label: string; usage: UsageDto }) {
  const percent = percentOf(usage);
  return (
    <span className="mt-2 grid gap-1 text-xs">
      <span className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {usage.used.toLocaleString("en")} / {usage.limit.toLocaleString("en")}
        </span>
      </span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
        className="block h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500 ease-out",
            usage.state === "ok" ? "bg-forest" : "bg-warning",
            usage.state === "reached" && "bg-destructive",
          )}
          style={{ width: `${percent}%` }}
        />
      </span>
    </span>
  );
}

/** What reaching the month's agent actions means, on the tile and in setup. */
export const allowanceReached =
  "New agent actions are blocked until the monthly limit resets or increases.";

/** This month's agent actions and run steps; billing is a link away for owners. */
function UsageTile({
  usage,
  billingHref,
}: {
  usage: PlanUsageDto;
  billingHref: string | null;
}) {
  const state = worst([usage.actions.state, usage.steps.state]);
  const content = (
    <>
      <TileTop label="Plan usage this month" badge={usageBadges[state]} />
      <Figure value={usageShare(usage.actions)}>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          of agent actions
        </span>
      </Figure>
      <UsageBar label="Agent actions" usage={usage.actions} />
      <UsageBar label="Run steps (included)" usage={usage.steps} />
      {usage.actions.state === "reached" ? (
        <span role="status" className={detailClass}>
          {allowanceReached}
        </span>
      ) : null}
    </>
  );
  return billingHref ? (
    <Link
      href={`${billingHref}#billing-usage`}
      data-slot="health-tile"
      data-tile="usage"
      className={linkedTileClass}
    >
      {content}
    </Link>
  ) : (
    <div data-slot="health-tile" data-tile="usage" className={tileClass}>
      {content}
    </div>
  );
}

function ActivityUsageTile({ usage }: { usage: PlanUsageDto }) {
  return (
    <div data-slot="health-tile" data-tile="usage" className={tileClass}>
      <TileTop label="Usage this month" />
      <Figure value={count(usage.actions.used)}>
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          agent actions
        </span>
      </Figure>
      <span className={detailClass}>{count(usage.steps.used)} run steps</span>
      {usage.actions.state === "reached" ? (
        <span role="status" className={detailClass}>
          {allowanceReached}
        </span>
      ) : null}
    </div>
  );
}

function ProblemLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block truncate rounded-sm text-body hover:text-foreground hover:underline",
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}

const more = (count: number) => (count > 1 ? ` and ${count - 1} more` : "");

/** When a silent installation last checked in, or that it never has. */
function SilentLink({ base, health }: { base: string; health: HealthDto }) {
  const [silent] = health.silent;
  if (!silent) return null;
  return (
    <ProblemLink href={`${base}/agents/${silent.agentKey}`}>
      Silent: {silent.installationName},{" "}
      {silent.lastSeenAt ? (
        <>
          last check-in{" "}
          <span suppressHydrationWarning>{timeAgo(silent.lastSeenAt)}</span>
        </>
      ) : (
        "no check-in yet"
      )}
      {more(health.silent.length)}
    </ProblemLink>
  );
}

/** Reports of actions Nodrail never allowed, linked to them in Activity. */
function MismatchLink({ base, health }: { base: string; health: HealthDto }) {
  const [latest] = health.mismatched;
  if (!latest) return null;
  return (
    <ProblemLink href={`${base}/activity?kind=mismatches`}>
      Report doesn&apos;t match decision: {latest.agentKey}, {latest.toolKey}.
      {latest.operationKey}
      {more(health.mismatched.length)}
    </ProblemLink>
  );
}

/**
 * Silent installations, stalled steps, installations no rule covers and
 * reports of actions Nodrail never allowed, each linked to its fix.
 */
function ProblemsTile({ base, health }: { base: string; health: HealthDto }) {
  const count = problemCount(health);
  const [stalled] = health.stalledSteps;
  const [uncovered] = health.uncovered;
  return (
    <div data-slot="health-tile" data-tile="problems" className={tileClass}>
      <TileTop
        label="Problems"
        badge={
          count
            ? { tone: "danger", text: plural(count, "problem") }
            : { tone: "success", text: "None" }
        }
      />
      <Figure value={count} />
      <span className={cn(detailClass, "grid gap-1")}>
        <MismatchLink base={base} health={health} />
        <SilentLink base={base} health={health} />
        {stalled ? (
          <ProblemLink href={runPath(base, stalled.runId)}>
            Stalled: {stalled.runKey}, {stalled.stepAgent} step, last activity{" "}
            <span suppressHydrationWarning>
              {timeAgo(stalled.lastActivityAt)}
            </span>
            {more(health.stalledSteps.length)}
          </ProblemLink>
        ) : null}
        {uncovered ? (
          <ProblemLink href={`${base}/agents/${uncovered.agentKey}`}>
            No rule for {uncovered.installationName}: {uncovered.uncovered} of{" "}
            {uncovered.actions} actions this week
            {more(health.uncovered.length)}
          </ProblemLink>
        ) : null}
        {count
          ? null
          : "No silent agents or stalled steps, and rules cover what agents ask."}
      </span>
    </div>
  );
}

/** Is everything healthy? Agents, plan usage and problems, each linked to its fix. */
export function HealthTiles({
  base,
  health,
  usage,
  billingHref,
  showBilling = true,
}: {
  base: string;
  health: HealthDto;
  usage: PlanUsageDto;
  showBilling?: boolean;
  /** The billing page, for who manages billing; null for everyone else. */
  billingHref: string | null;
}) {
  return (
    <div
      data-slot="health-row"
      className="stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3 *:min-w-0"
    >
      <AgentsTile base={base} health={health} />
      {showBilling ? (
        <UsageTile usage={usage} billingHref={billingHref} />
      ) : (
        <ActivityUsageTile usage={usage} />
      )}
      <ProblemsTile base={base} health={health} />
    </div>
  );
}
