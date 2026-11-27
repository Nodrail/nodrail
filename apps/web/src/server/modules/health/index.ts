import "server-only";
import { z } from "zod";
import { REPORTING_WINDOW_MINUTES } from "@/contracts/v1/agents";
import {
  COVERAGE_MIN_ACTIONS,
  COVERAGE_WINDOW_DAYS,
  HEALTH_LIST_LIMIT,
  STALLED_STEP_MINUTES,
  type HealthDto,
  type MismatchedReportDto,
  type PausedAgentDto,
  type SilentInstallationDto,
  type StalledStepDto,
  type UncoveredInstallationDto,
} from "@/contracts/v1/health";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import { reportMismatch } from "@/server/modules/activity/mismatch";
import { countAgents } from "@/server/modules/agents";
import { disconnectedInstallation } from "@/server/modules/agents/installation-view";
import { visibleInEnvironment } from "@/server/modules/agents/list";
import { findEnvironment } from "@/server/modules/workspaces";

/*
 * What is wrong in an environment, read through the same per-person row level
 * security as every other screen: a viewer only hears about the
 * agents assigned to them, and runs of agents they cannot see do not exist.
 * Each check takes the environment's slug, as the other read modules do;
 * `getHealth` reads them all at once for Overview and Insights.
 */

/** Installations with their agents; `live` keeps the unarchived ones here. */
const installations = `
  FROM nodrail.installations i
  JOIN nodrail.agents a ON a.workspace_id = i.workspace_id AND a.id = i.agent_id`;
const live = `
  i.workspace_id = $1 AND i.environment_id = $2
  AND i.archived_at IS NULL AND a.archived_at IS NULL`;

const silentRow = z.object({
  agent_key: z.string(),
  installation_name: z.string(),
  last_seen_at: z.date().nullable(),
});

async function silentIn(
  context: WorkspaceContext,
  environmentId: string,
): Promise<SilentInstallationDto[]> {
  const rows = parseRows(
    silentRow,
    await context.manager.query(
      `SELECT a.external_key AS agent_key, i.name AS installation_name,
              i.last_seen_at
       ${installations}
       WHERE ${live}
         AND NOT (${disconnectedInstallation})
         AND (i.last_seen_at IS NULL
              OR i.last_seen_at <= clock_timestamp() - make_interval(mins => $3))
       ORDER BY i.last_seen_at DESC NULLS LAST, i.name
       LIMIT $4`,
      [
        context.workspaceId,
        environmentId,
        REPORTING_WINDOW_MINUTES,
        HEALTH_LIST_LIMIT,
      ],
    ),
  );
  return rows.map((row) => ({
    agentKey: row.agent_key,
    installationName: row.installation_name,
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
  }));
}

const pausedRow = z.object({
  agent_key: z.string(),
  paused_at: z.date().nullable(),
  paused_by: z.string().nullable(),
});

async function pausedIn(
  context: WorkspaceContext,
  environmentId: string,
): Promise<PausedAgentDto[]> {
  const rows = parseRows(
    pausedRow,
    await context.manager.query(
      `SELECT a.external_key AS agent_key, a.paused_at,
              p.display_name AS paused_by
       FROM nodrail.agents a
       LEFT JOIN nodrail.users p ON p.id = a.paused_by
       WHERE a.workspace_id = $1 AND a.archived_at IS NULL
         AND a.access_status = 'paused'
         AND ${visibleInEnvironment}
       ORDER BY a.paused_at DESC NULLS LAST, a.external_key
       LIMIT $3`,
      [context.workspaceId, environmentId, HEALTH_LIST_LIMIT],
    ),
  );
  return rows.map((row) => ({
    agentKey: row.agent_key,
    pausedAt: row.paused_at?.toISOString() ?? null,
    pausedBy: row.paused_by,
  }));
}

const stalledRow = z.object({
  run_id: z.uuid(),
  run_key: z.string(),
  step_key: z.string(),
  agent: z.string(),
  started_at: z.date(),
  last_activity_at: z.date(),
});

async function stalledIn(
  context: WorkspaceContext,
  environmentId: string,
): Promise<StalledStepDto[]> {
  const rows = parseRows(
    stalledRow,
    await context.manager.query(
      `SELECT r.id AS run_id, r.key AS run_key, s.step_key, s.agent,
              s.started_at, r.last_activity_at
       FROM nodrail.run_steps s
       JOIN nodrail.runs r ON r.workspace_id = s.workspace_id AND r.id = s.run_id
       WHERE s.workspace_id = $1 AND r.environment_id = $2
         AND s.started_at IS NOT NULL AND s.finished_at IS NULL
         AND r.last_activity_at <= clock_timestamp() - make_interval(mins => $3)
       ORDER BY r.last_activity_at DESC, s.started_seq DESC
       LIMIT $4`,
      [
        context.workspaceId,
        environmentId,
        STALLED_STEP_MINUTES,
        HEALTH_LIST_LIMIT,
      ],
    ),
  );
  return rows.map((row) => ({
    runId: row.run_id,
    runKey: row.run_key,
    stepKey: row.step_key,
    stepAgent: row.agent,
    since: row.started_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
  }));
}

const uncoveredRow = z.object({
  agent_key: z.string(),
  installation_name: z.string(),
  actions: z.number(),
  uncovered: z.number(),
});

async function uncoveredIn(
  context: WorkspaceContext,
  environmentId: string,
): Promise<UncoveredInstallationDto[]> {
  const rows = parseRows(
    uncoveredRow,
    await context.manager.query(
      `SELECT a.external_key AS agent_key, i.name AS installation_name,
              c.actions, c.uncovered
       ${installations}
       JOIN LATERAL (
         SELECT count(*)::int AS actions,
                count(*) FILTER (
                  WHERE EXISTS (
                    SELECT 1 FROM nodrail.audit_events e
                    WHERE e.workspace_id = ar.workspace_id
                      AND e.action_request_id = ar.id
                      AND e.decision_code = 'denied_no_rule')
                )::int AS uncovered
         FROM nodrail.action_requests ar
         WHERE ar.workspace_id = i.workspace_id AND ar.installation_id = i.id
           AND ar.access_epoch > 0
           AND ar.created_at >= clock_timestamp() - make_interval(days => $3)
       ) c ON true
       WHERE ${live}
         AND c.actions >= $4 AND c.uncovered * 2 > c.actions
       ORDER BY c.uncovered DESC, i.name
       LIMIT $5`,
      [
        context.workspaceId,
        environmentId,
        COVERAGE_WINDOW_DAYS,
        COVERAGE_MIN_ACTIONS,
        HEALTH_LIST_LIMIT,
      ],
    ),
  );
  return rows.map((row) => ({
    agentKey: row.agent_key,
    installationName: row.installation_name,
    actions: row.actions,
    uncovered: row.uncovered,
  }));
}

const mismatchRow = z.object({
  agent_key: z.string(),
  tool_key: z.string(),
  operation_key: z.string(),
  reported_at: z.date(),
});

/** Actions the integration says ran, though Nodrail never allowed them. */
async function mismatchedIn(
  context: WorkspaceContext,
  environmentId: string,
): Promise<MismatchedReportDto[]> {
  const rows = parseRows(
    mismatchRow,
    await context.manager.query(
      `SELECT a.external_key AS agent_key, ar.tool_key, ar.operation_key,
              max(c.received_at) AS reported_at
       FROM nodrail.action_requests ar
       JOIN nodrail.agents a ON a.workspace_id = ar.workspace_id AND a.id = ar.agent_id
       JOIN nodrail.client_reports c
         ON c.workspace_id = ar.workspace_id AND c.action_request_id = ar.id
       WHERE ar.workspace_id = $1 AND ar.environment_id = $2
         AND c.received_at >= clock_timestamp() - make_interval(days => $3)
         AND ${reportMismatch("ar.id", "$1")}
       GROUP BY ar.id, a.external_key
       ORDER BY reported_at DESC
       LIMIT $4`,
      [
        context.workspaceId,
        environmentId,
        COVERAGE_WINDOW_DAYS,
        HEALTH_LIST_LIMIT,
      ],
    ),
  );
  return rows.map((row) => ({
    agentKey: row.agent_key,
    toolKey: row.tool_key,
    operationKey: row.operation_key,
    reportedAt: row.reported_at.toISOString(),
  }));
}

type Check<T> = (
  context: WorkspaceContext,
  environmentId: string,
) => Promise<T>;

/** A check by environment slug; an unknown slug is NOT_FOUND. */
const bySlug =
  <T>(check: Check<T>) =>
  async (context: WorkspaceContext, environmentSlug: string) =>
    check(context, (await findEnvironment(context, environmentSlug)).id);

/** Installations that have not checked in within the reporting window. */
export const silentAgents = bySlug(silentIn);

/** Agents paused by a person, with an installation in this environment. */
export const pausedAgents = bySlug(pausedIn);

/** Open steps in runs with no activity for `STALLED_STEP_MINUTES`. */
export const stalledSteps = bySlug(stalledIn);

/**
 * Installations with at least `COVERAGE_MIN_ACTIONS` actions in the last
 * `COVERAGE_WINDOW_DAYS` days, more than half of which matched no rule.
 */
export const uncoveredInstallations = bySlug(uncoveredIn);

/** Every health check for one environment, as this person may see it. */
export const getHealth = bySlug(
  async (context, environmentId): Promise<HealthDto> => ({
    agents: await countAgents(context, environmentId),
    silent: await silentIn(context, environmentId),
    paused: await pausedIn(context, environmentId),
    stalledSteps: await stalledIn(context, environmentId),
    uncovered: await uncoveredIn(context, environmentId),
    mismatched: await mismatchedIn(context, environmentId),
  }),
);
