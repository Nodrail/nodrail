import "server-only";
import { budgetState, type PolicyBudget, type RunEvent } from "@nodrail/sdk";
import { z } from "zod";
import {
  IMPACT_DAYS,
  LAST_MATCHED_DAYS,
  type BudgetUsageDto,
} from "@/contracts/v1/policy-impact";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import { windowStart } from "@/server/modules/insights/window";
import { storedRunPolicy } from "@/server/modules/runs/policy";
import { findEnvironment } from "@/server/modules/workspaces";
import { eventsOf } from "./recent";

// How the live rules and budgets have been doing: what the Rules and Budgets
// tabs show beside each entry.

/** The runs whose budgets the Budgets tab counts, latest first. */
const USAGE_RUNS = 100;

/**
 * When each rule last decided an action: a denial, or a permit it allowed or
 * that a person allowed after it asked. Keyed by logical rule id.
 */
export async function ruleLastMatched(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<Record<string, string>> {
  const { id } = await findEnvironment(context, environmentSlug);
  const rows = parseRows(
    z.object({ id: z.uuid(), last_at: z.date() }),
    await context.manager.query(
      `SELECT matched_logical_rule_id AS id, max(occurred_at) AS last_at
       FROM nodrail.audit_events
       WHERE workspace_id = $1 AND environment_id = $2
         AND occurred_at >= ${windowStart}
         AND event_type IN ('authorization.decided', 'authorization.permit_issued')
         AND matched_logical_rule_id IS NOT NULL
       GROUP BY matched_logical_rule_id`,
      [context.workspaceId, id, LAST_MATCHED_DAYS],
    ),
  );
  return Object.fromEntries(
    rows.map((row) => [row.id, row.last_at.toISOString()]),
  );
}

/** The most a budget had counted when one of the run's actions was checked. */
export function peakIn(budget: PolicyBudget, key: string, events: RunEvent[]) {
  let peak: number | null = null;
  events.forEach((event, at) => {
    if (event.type !== "action") return;
    const state = budgetState(budget, {
      run: key,
      step: event.step ? { id: event.step, agent: event.agent } : null,
      events: events.slice(0, at),
    });
    if (state) peak = Math.max(peak ?? 0, state.used);
  });
  return peak;
}

/** Runs each budget held at least once in the window, by budget id. */
async function heldRuns(context: WorkspaceContext, environmentId: string) {
  const rows = parseRows(
    z.object({ id: z.string(), runs: z.number() }),
    await context.manager.query(
      `SELECT run_hold->>'id' AS id, count(DISTINCT run_id)::int AS runs
       FROM nodrail.action_requests
       WHERE workspace_id = $1 AND environment_id = $2
         AND created_at >= ${windowStart}
         AND run_hold->>'kind' = 'budget' AND run_id IS NOT NULL
       GROUP BY run_hold->>'id'`,
      [context.workspaceId, environmentId, IMPACT_DAYS],
    ),
  );
  return new Map(rows.map((row) => [row.id, row.runs]));
}

/**
 * Each live budget over the window's latest runs: its peak when an action
 * was checked, the runs it counted in, and the runs it held. By budget id.
 */
export async function budgetUsage(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<Record<string, BudgetUsageDto>> {
  const { id: environmentId } = await findEnvironment(context, environmentSlug);
  const { budgets } = await storedRunPolicy(context, environmentId);
  if (!budgets.length) return {};
  const runs = parseRows(
    z.object({ id: z.uuid(), key: z.string() }),
    await context.manager.query(
      `SELECT id, key FROM nodrail.runs
       WHERE workspace_id = $1 AND environment_id = $2
         AND last_activity_at >= ${windowStart}
       ORDER BY last_activity_at DESC, id
       LIMIT $4`,
      [context.workspaceId, environmentId, IMPACT_DAYS, USAGE_RUNS],
    ),
  );
  const histories: { key: string; events: RunEvent[] }[] = [];
  for (const run of runs) {
    const events = await eventsOf(context, run.id);
    if (events) histories.push({ key: run.key, events });
  }
  const held = await heldRuns(context, environmentId);
  return Object.fromEntries(
    budgets.map((budget) => {
      const peaks = histories
        .map(({ key, events }) => peakIn(budget, key, events))
        .filter((peak) => peak !== null);
      return [
        budget.id,
        {
          peak: peaks.length ? Math.max(...peaks) : null,
          runs: peaks.length,
          held: held.get(budget.id) ?? 0,
        },
      ];
    }),
  );
}
