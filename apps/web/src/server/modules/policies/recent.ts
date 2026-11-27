import "server-only";
import type { Descriptor, RunContext, RunEvent } from "@nodrail/policy-engine";
import { z } from "zod";
import { IMPACT_DAYS } from "@/contracts/v1/policy-impact";
import {
  AppError,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  actionColumns,
  descriptorOf,
} from "@/server/modules/authorizations/action-columns";
import { windowStart } from "@/server/modules/insights/window";
import { runEvents } from "@/server/modules/runs/history";

// The environment's recent actions, each with its run as a decision read it:
// what the impact preview and budget usage replay against the policies.

/** The latest actions of the window that a preview decides again. */
export const RECENT_LIMIT = 300;

/** A recorded action, and its run up to just before it, if it had one. */
export type RecentAction = {
  id: string;
  descriptor: Descriptor;
  runId: string | null;
  run: RunContext | null;
};

const actionRow = z.object({
  id: z.uuid(),
  agent_id: z.uuid(),
  installation_id: z.uuid(),
  ...actionColumns,
  run_id: z.uuid().nullable(),
  run_key: z.string().nullable(),
  prior: z.number(),
  total: z.number(),
});

/**
 * The latest actions of the window, newest first, with how many actions came
 * before each in its run. A run is only an action's own when its
 * installation declared it, as when it was decided.
 */
const actionsSql = `
  SELECT ar.id, ar.agent_id, ar.installation_id, ar.tool_key,
         ar.operation_key, ar.resource_kind, ar.resource_id, ar.params_safe,
         r.id AS run_id, r.key AS run_key,
         (SELECT count(*)::int FROM nodrail.action_requests p
          WHERE p.workspace_id = ar.workspace_id AND p.run_id = ar.run_id
            AND p.run_seq < ar.run_seq) AS prior,
         count(*) OVER ()::int AS total
  FROM nodrail.action_requests ar
  LEFT JOIN nodrail.runs r
    ON r.workspace_id = ar.workspace_id AND r.id = ar.run_id
   AND r.installation_id = ar.installation_id
  WHERE ar.workspace_id = $1 AND ar.environment_id = $2
    AND ar.access_epoch > 0 AND ar.created_at >= ${windowStart}
  ORDER BY ar.created_at DESC, ar.id
  LIMIT $4`;

/** A run's events, or null when it is too long to decide on. */
export async function eventsOf(context: WorkspaceContext, runId: string) {
  try {
    return await runEvents(context, runId);
  } catch (error) {
    if (error instanceof AppError && error.code === "RUN_TOO_LONG") return null;
    throw error;
  }
}

/** The run as the engine reads it when deciding the run's nth action. */
export function contextAt(
  key: string,
  events: RunEvent[],
  nth: number,
): RunContext | null {
  let seen = 0;
  for (const [at, event] of events.entries()) {
    if (event.type !== "action") continue;
    if (seen === nth)
      return {
        run: key,
        step: event.step ? { id: event.step, agent: event.agent } : null,
        events: events.slice(0, at),
      };
    seen += 1;
  }
  return null;
}

/**
 * The window's latest actions in an environment. With `withRuns`, each comes
 * with its run's history up to it, for gates and budgets to read.
 */
export async function recentActions(
  context: WorkspaceContext,
  environmentId: string,
  withRuns: boolean,
) {
  const rows = parseRows(
    actionRow,
    await context.manager.query(actionsSql, [
      context.workspaceId,
      environmentId,
      IMPACT_DAYS,
      RECENT_LIMIT,
    ]),
  );
  const runs = new Map<string, RunEvent[] | null>();
  if (withRuns)
    for (const runId of new Set(rows.map((row) => row.run_id)))
      if (runId) runs.set(runId, await eventsOf(context, runId));
  const actions: RecentAction[] = [];
  for (const row of rows) {
    const events = row.run_id ? runs.get(row.run_id) : null;
    const run =
      events && row.run_key ? contextAt(row.run_key, events, row.prior) : null;
    // A run too long to read would decide as no run at all: left out instead.
    if (withRuns && row.run_id && !run) continue;
    actions.push({
      id: row.id,
      descriptor: descriptorOf(row),
      runId: row.run_id,
      run,
    });
  }
  return { actions, total: rows[0]?.total ?? 0 };
}
