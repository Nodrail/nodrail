import "server-only";
import { z } from "zod";
import {
  REPORTING_WINDOW_MINUTES,
  type AgentListDto,
} from "@/contracts/v1/agents";
import type { AgentCountsDto } from "@/contracts/v1/activity";
import {
  decodeCursor,
  encodeCursor,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";
import {
  accessColumns,
  admittedAgent,
  disconnectedInstallation,
  installationOwner,
  installationRow,
  installationSelect,
  toAccess,
  toInstallation,
} from "./installation-view";

const PAGE_SIZE = 50;

const listRow = z.object({
  id: z.uuid(),
  external_key: z.string(),
  description: z.string().nullable(),
  cursor_at: z.string(),
  ...accessColumns,
  managed_project_id: z.uuid().nullable(),
  project_name: z.string().nullable(),
  entry_agent: z.string().nullable(),
});

const hasInstallation = `EXISTS (SELECT 1 FROM nodrail.installations i
  WHERE i.workspace_id = a.workspace_id AND i.environment_id = $2 AND i.archived_at IS NULL
    AND (i.agent_id = a.id OR (${admittedAgent})))`;

export const visibleInEnvironment = `(${hasInstallation} OR EXISTS (
  SELECT 1 FROM nodrail.active_policies live
  JOIN nodrail.policy_versions v ON v.workspace_id = live.workspace_id AND v.id = live.policy_version_id
  WHERE live.workspace_id = a.workspace_id AND live.environment_id = $2
    AND v.managed_project_id = a.managed_project_id
    AND a.external_key = ANY(v.managed_agent_keys)))`;

const countsRow = z.object({
  connected: z.number(),
  reporting: z.number(),
  paused: z.number(),
});

/** The figures shown on Agents and Overview. Limited to who may see them. */
export async function countAgents(
  context: WorkspaceContext,
  environmentId: string,
): Promise<AgentCountsDto> {
  const [counts] = parseRows(
    countsRow,
    await context.manager.query(
      `SELECT count(*)::int AS connected,
              count(*) FILTER (
                WHERE i.last_seen_at > clock_timestamp() - make_interval(mins => $3)
              )::int AS reporting,
              (SELECT count(*)::int FROM nodrail.agents a
               WHERE a.workspace_id = $1 AND a.archived_at IS NULL
                 AND a.access_status = 'paused' AND ${visibleInEnvironment}) AS paused
       FROM nodrail.installations i
       JOIN nodrail.agents a
         ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
       WHERE i.workspace_id = $1 AND i.environment_id = $2
         AND i.archived_at IS NULL AND a.archived_at IS NULL
         AND NOT (${disconnectedInstallation})`,
      [context.workspaceId, environmentId, REPORTING_WINDOW_MINUTES],
    ),
  );
  return counts ?? { connected: 0, reporting: 0, paused: 0 };
}

export async function listAgents(
  context: WorkspaceContext,
  environmentSlug: string,
  cursorValue?: string,
  installedOnly = false,
): Promise<AgentListDto> {
  const { manager, workspaceId } = context;
  const environment = await findEnvironment(context, environmentSlug);
  const cursor = decodeCursor(cursorValue);

  const rows = parseRows(
    listRow,
    await manager.query(
      `SELECT a.id, a.external_key, a.description, a.access_status, a.paused_at,
              p.display_name AS paused_by_name, a.created_at::text AS cursor_at,
              a.managed_project_id, r.project AS project_name, r.entry_agent
       FROM nodrail.agents a
       LEFT JOIN nodrail.users p ON p.id = a.paused_by
       LEFT JOIN nodrail.intended_revisions r ON r.workspace_id = a.workspace_id
         AND r.project_id = a.managed_project_id AND r.environment_id = $2
       WHERE a.workspace_id = $1 AND a.archived_at IS NULL
         AND ${installedOnly ? hasInstallation : visibleInEnvironment}
         AND ($3::timestamptz IS NULL
              OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5`,
      [workspaceId, environment.id, cursor.at, cursor.id, PAGE_SIZE + 1],
    ),
  );

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  const machines = parseRows(
    installationRow.extend({ owner: z.uuid(), tools: z.array(z.string()) }),
    await manager.query(
      `SELECT ${installationSelect}, a.id AS owner,
              ARRAY(SELECT DISTINCT o.tool_key FROM nodrail.observed_permissions o
                    WHERE o.workspace_id = i.workspace_id AND o.installation_id = i.id
                    ORDER BY o.tool_key) AS tools
       FROM nodrail.installations i
       ${installationOwner}
       JOIN nodrail.agents a ON a.workspace_id = i.workspace_id
         AND (i.agent_id = a.id OR (${admittedAgent}))
       WHERE i.workspace_id = $1 AND i.environment_id = $2 AND i.archived_at IS NULL
         AND a.id = ANY($3::uuid[])
       ORDER BY i.name, i.id`,
      [workspaceId, environment.id, page.map(({ id }) => id)],
    ),
  );
  return {
    items: page.map((row) => {
      const matching = machines.filter(({ owner }) => owner === row.id);
      const installations = matching.map(toInstallation);
      return {
        key: row.external_key,
        description: row.description,
        project: row.managed_project_id,
        projectName: row.project_name,
        entryAgent: row.entry_agent,
        access: toAccess(row),
        installation: installations[0] ?? null,
        installations,
        tools: [...new Set(matching.flatMap(({ tools }) => tools))].sort(),
      };
    }),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor(last.cursor_at, last.id)
        : null,
    summary: await countAgents(context, environment.id),
  };
}
