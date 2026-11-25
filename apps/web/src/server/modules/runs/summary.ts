import "server-only";
import { z } from "zod";
import { activityQuery } from "@/contracts/v1/activity-query";
import type {
  RunHoldDto,
  RunListDto,
  RunStatus,
  RunSummaryDto,
} from "@/contracts/v1/runs";
import {
  AppError,
  decodeCursor,
  encodeCursor,
  parseInput,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import { escapeLike, sinceFor } from "@/server/modules/activity/source";
import { findEnvironment } from "@/server/modules/workspaces";

const PAGE_SIZE = 50;

const summaryRow = z.object({
  id: z.uuid(),
  key: z.string(),
  installation_name: z.string(),
  agent_key: z.string().nullable(),
  created_at: z.date(),
  last_activity_at: z.date(),
  cursor_at: z.string(),
  steps: z.number(),
  actions: z.number(),
  held: z.number(),
  running: z.boolean(),
  agents: z.array(
    z.object({
      agent: z.string(),
      steps: z.number(),
      verdict: z.string().nullable(),
      finished: z.boolean(),
    }),
  ),
  holding: z.custom<RunHoldDto>().nullable(),
});

/** Each run with its counts, its step agents and what holds it now. */
const summarySelect = `
  SELECT r.id, r.key, i.name AS installation_name, a.external_key AS agent_key,
         r.created_at, r.last_activity_at, r.last_activity_at::text AS cursor_at,
         (SELECT count(*)::int FROM nodrail.run_steps s
          WHERE s.workspace_id = r.workspace_id AND s.run_id = r.id) AS steps,
         (SELECT count(*)::int FROM nodrail.action_requests ar
          WHERE ar.workspace_id = r.workspace_id AND ar.run_id = r.id) AS actions,
         (SELECT count(*)::int FROM nodrail.action_requests ar
          WHERE ar.workspace_id = r.workspace_id AND ar.run_id = r.id
            AND ar.run_hold IS NOT NULL) AS held,
         EXISTS (SELECT 1 FROM nodrail.run_steps s
          WHERE s.workspace_id = r.workspace_id AND s.run_id = r.id
            AND s.started_at IS NOT NULL AND s.finished_at IS NULL) AS running,
         (SELECT COALESCE(json_agg(json_build_object(
                   'agent', g.agent, 'steps', g.steps, 'verdict', g.verdict,
                   'finished', g.finished) ORDER BY g.first_seq NULLS LAST, g.agent),
                 '[]'::json)
          FROM (SELECT s.agent, count(*)::int AS steps, min(s.started_seq) AS first_seq,
                       (array_agg(s.verdict ORDER BY s.started_seq DESC NULLS LAST))[1] AS verdict,
                       (array_agg(s.finished_at IS NOT NULL
                                  ORDER BY s.started_seq DESC NULLS LAST))[1] AS finished
                FROM nodrail.run_steps s
                WHERE s.workspace_id = r.workspace_id AND s.run_id = r.id
                GROUP BY s.agent) g) AS agents,
         (SELECT ar.run_hold
          FROM nodrail.action_requests ar
          WHERE ar.workspace_id = r.workspace_id AND ar.run_id = r.id
          ORDER BY ar.run_seq DESC NULLS LAST, ar.created_at DESC
          LIMIT 1) AS holding
  FROM nodrail.runs r
  JOIN nodrail.installations i
    ON i.workspace_id = r.workspace_id AND i.id = r.installation_id
  LEFT JOIN nodrail.agents a
    ON a.workspace_id = r.workspace_id AND a.id = i.agent_id`;

function statusOf(row: z.infer<typeof summaryRow>): RunStatus {
  if (row.holding) return "held";
  return row.running ? "running" : "idle";
}

const toSummary = (row: z.infer<typeof summaryRow>): RunSummaryDto => ({
  id: row.id,
  key: row.key,
  installationName: row.installation_name,
  agentKey: row.agent_key,
  createdAt: row.created_at.toISOString(),
  lastActivityAt: row.last_activity_at.toISOString(),
  steps: row.steps,
  actions: row.actions,
  held: row.held,
  agents: row.agents,
  holding: row.holding
    ? {
        kind: row.holding.kind,
        name: row.holding.name,
        missing: row.holding.missing ?? [],
      }
    : null,
  status: statusOf(row),
});

/** Runs with an action this outcome describes; the event list's outcomes. */
const outcomeExists = `
  ($6::text IS NULL OR EXISTS (
    SELECT 1 FROM nodrail.action_requests ar
    WHERE ar.workspace_id = r.workspace_id AND ar.run_id = r.id AND CASE $6
      WHEN 'allowed' THEN ar.initial_evaluation = 'ready'
      WHEN 'denied' THEN ar.initial_evaluation = 'denied'
      WHEN 'held' THEN ar.run_hold IS NOT NULL
    END))`;

/**
 * Runs in this environment, the most recently active first, narrowed by
 * Activity's shared filters: search, agent, outcome and time range.
 */
export async function listRuns(
  context: WorkspaceContext,
  environmentSlug: string,
  rawQuery: unknown = {},
  pageSize = PAGE_SIZE,
): Promise<RunListDto> {
  const query = parseInput(activityQuery, rawQuery);
  const environment = await findEnvironment(context, environmentSlug);
  const cursor = decodeCursor(query.cursor);
  const rows = parseRows(
    summaryRow,
    await context.manager.query(
      `${summarySelect}
       WHERE r.workspace_id = $1 AND r.environment_id = $2
         AND ($3::text IS NULL
              OR concat_ws(' ', r.key, i.name, a.external_key) ILIKE $3)
         AND ($4::text IS NULL OR a.external_key = $4)
         AND ($5::interval IS NULL
              OR r.last_activity_at >= clock_timestamp() - $5::interval)
         AND ${outcomeExists}
         AND ($7::timestamptz IS NULL
              OR (r.last_activity_at, r.id) < ($7::timestamptz, $8::uuid))
       ORDER BY r.last_activity_at DESC, r.id DESC
       LIMIT $9`,
      [
        context.workspaceId,
        environment.id,
        query.q ? `%${escapeLike(query.q)}%` : null,
        query.agent || null,
        sinceFor(query.range),
        query.outcome === "all" ? null : query.outcome,
        cursor.at,
        cursor.id,
        pageSize + 1,
      ],
    ),
  );
  const page = rows.slice(0, pageSize);
  const last = page.at(-1);
  return {
    runs: page.map(toSummary),
    nextCursor:
      rows.length > pageSize && last
        ? encodeCursor(last.cursor_at, last.id)
        : null,
  };
}

/** One run's summary. Hidden unless the database shows it to this person. */
export async function getRunSummary(
  context: WorkspaceContext,
  environmentSlug: string,
  runId: string,
): Promise<RunSummaryDto> {
  if (!z.uuid().safeParse(runId).success) throw new AppError("NOT_FOUND");
  const environment = await findEnvironment(context, environmentSlug);
  const [row] = parseRows(
    summaryRow,
    await context.manager.query(
      `${summarySelect}
       WHERE r.workspace_id = $1 AND r.environment_id = $2 AND r.id = $3`,
      [context.workspaceId, environment.id, runId],
    ),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return toSummary(row);
}

/** How far back held runs are looked for; older ones are not news. */
const HELD_WITHIN = "7 days";

/** Runs a gate or budget holds now, the most recently active first. */
export async function listHeldRuns(
  context: WorkspaceContext,
  environmentSlug: string,
  limit: number,
): Promise<RunSummaryDto[]> {
  const environment = await findEnvironment(context, environmentSlug);
  const rows = parseRows(
    summaryRow,
    await context.manager.query(
      `SELECT * FROM (
         ${summarySelect}
         WHERE r.workspace_id = $1 AND r.environment_id = $2
           AND r.last_activity_at >= clock_timestamp() - $3::interval
       ) run
       WHERE run.holding IS NOT NULL
       ORDER BY run.last_activity_at DESC, run.id DESC
       LIMIT $4`,
      [context.workspaceId, environment.id, HELD_WITHIN, limit],
    ),
  );
  return rows.map(toSummary);
}
