import "server-only";
import { z } from "zod";
import type { ActivityEventDto } from "@/contracts/v1/activity";
import { activityQuery } from "@/contracts/v1/activity-query";
import {
  TREND_DAYS,
  todayOutcomes,
  type OverviewStateDto,
  type PlanUsageDto,
  type TodayDto,
} from "@/contracts/v1/overview";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import {
  codesForOutcome,
  eventSource,
  queryEvents,
} from "@/server/modules/activity/source";
import { countAgents } from "@/server/modules/agents";
import { getUsageNotice } from "@/server/modules/billing/metering";
import { findEnvironment } from "@/server/modules/workspaces";

/*
 * Overview's own reads. Every figure comes from the query behind the page it
 * links to (Agents, Activity, Settings), through the same per-person
 * row level security, so a figure and its page always agree.
 */

const decisions = activityQuery.parse({ kind: "decisions" });

/** Setup and agents: what the page shows at all. */
export async function getOverviewState(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<OverviewStateDto> {
  const environment = await findEnvironment(context, environmentSlug);
  const [firstContact]: unknown[] = await context.manager.query(
    `SELECT 1 FROM nodrail.installations
     WHERE workspace_id = $1 AND environment_id = $2
       AND archived_at IS NULL AND last_seen_at IS NOT NULL
     LIMIT 1`,
    [context.workspaceId, environment.id],
  );
  const { items } = await queryEvents(context, environment.id, decisions, {
    limit: 1,
  });
  return {
    checkedIn: Boolean(firstContact),
    agents: await countAgents(context, environment.id),
    anyDecision: items.length > 0,
  };
}

/** Enough recent decisions to fill five groups of repeats most of the time. */
const RECENT_DECISIONS = 40;

/** The latest decisions, newest first, for Overview to group. */
export async function getRecentDecisions(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<ActivityEventDto[]> {
  const environment = await findEnvironment(context, environmentSlug);
  const { items } = await queryEvents(context, environment.id, decisions, {
    limit: RECENT_DECISIONS,
  });
  return items;
}

const dayRow = z.object({
  day: z.number(),
  allowed: z.number(),
  denied: z.number(),
  held: z.number(),
});

/** Which 24-hour window before now a time falls in: 0 is the last 24 hours. */
const windowOf = (column: string) =>
  `LEAST(${TREND_DAYS - 1}, GREATEST(0,
     floor(extract(epoch FROM now() - ${column}) / 86400)))::int`;

/**
 * Allowed, denied and held over the last 24 hours, with a figure per day for
 * the last week. The outcomes are Activity's filters: the same codes, and
 * held is any action a gate or budget held.
 */
export async function getToday(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<TodayDto> {
  const environment = await findEnvironment(context, environmentSlug);
  const rows = parseRows(
    dayRow,
    await context.manager.query(
      `SELECT ${windowOf("e.occurred_at")} AS day,
                count(*) FILTER (WHERE e.decision_code = ANY($3))::int AS allowed,
                count(*) FILTER (WHERE e.decision_code = ANY($4))::int AS denied,
                count(*) FILTER (WHERE held.run_hold IS NOT NULL
                                    OR e.payload_safe->'hold' IS NOT NULL)::int AS held
         FROM (${eventSource}
               WHERE ev.occurred_at > now() - make_interval(days => $5)) e
         LEFT JOIN nodrail.action_requests held
           ON held.workspace_id = $1 AND held.id = e.action_id
         GROUP BY 1`,
      [
        context.workspaceId,
        environment.id,
        codesForOutcome("allowed"),
        codesForOutcome("denied"),
        TREND_DAYS,
      ],
    ),
  );
  const at = (day: number) => rows.find((row) => row.day === day);
  // Oldest first: window TREND_DAYS - 1 down to window 0.
  const windows = Array.from(
    { length: TREND_DAYS },
    (_, index) => TREND_DAYS - 1 - index,
  );
  const series = (pick: (row: z.infer<typeof dayRow>) => number) =>
    windows.map((day) => {
      const row = at(day);
      return row ? pick(row) : 0;
    });
  return Object.fromEntries(
    todayOutcomes.map((outcome) => {
      const days = series((row) => row[outcome]);
      return [outcome, { count: days.at(-1) ?? 0, days }];
    }),
  ) as TodayDto;
}

/** This month's agent actions and run steps against the plan. */
export async function getPlanUsage(
  context: WorkspaceContext,
): Promise<PlanUsageDto> {
  const { actions, steps } = await getUsageNotice(context);
  return { actions, steps };
}
