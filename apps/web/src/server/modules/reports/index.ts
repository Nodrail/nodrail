import "server-only";
import { MAIN_AGENT, type PolicyGate, type Requirement } from "@nodrail/sdk";
import { z } from "zod";
import type { ReportDto, ReportWindow } from "@/contracts/v1/reports";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import {
  actionColumns,
  descriptorOf,
} from "@/server/modules/authorizations/action-columns";
import { storedRunPolicy } from "@/server/modules/runs/policy";
import { windowStart } from "@/server/modules/insights/window";
import { findEnvironment } from "@/server/modules/workspaces";
import { computeReport, type ReportAction } from "./compute";

/** Runs active in the window; the database shows only what this person may see. */
const inWindow = `
  SELECT id FROM nodrail.runs
  WHERE workspace_id = $1 AND environment_id = $2
    AND last_activity_at >= ${windowStart}`;

const runRow = z.object({ id: z.uuid(), key: z.string() });

const stepRow = z.object({
  run_id: z.uuid(),
  step_key: z.string(),
  agent: z.string(),
  started_at: z.date().nullable(),
  finished_at: z.date().nullable(),
  verdict: z.string().nullable(),
  usd: z.number().nullable(),
  tokens: z.number().nullable(),
});

/** A receipt's usage figure, when it is a number. */
const usage = (metric: "usd" | "tokens") => `
  CASE WHEN jsonb_typeof(receipt->'usage'->'${metric}') = 'number'
       THEN (receipt->'usage'->>'${metric}')::float8 END AS ${metric}`;

const actionRow = z.object({
  id: z.uuid(),
  run_id: z.uuid(),
  decided_by: z.enum(["server", "host"]),
  created_at: z.date(),
  agent: z.string().nullable(),
  agent_id: z.uuid(),
  installation_id: z.uuid(),
  ...actionColumns,
  run_hold: z
    .object({
      kind: z.enum(["gate", "budget"]),
      id: z.string(),
      missing: z.array(z.custom<Requirement>()).optional(),
    })
    .nullable(),
});

const toAction = (row: z.infer<typeof actionRow>): ReportAction => ({
  id: row.id,
  runId: row.run_id,
  decidedBy: row.decided_by,
  at: row.created_at,
  agent: row.agent ?? MAIN_AGENT,
  descriptor: descriptorOf(row),
  hold: row.run_hold
    ? {
        kind: row.run_hold.kind,
        id: row.run_hold.id,
        missing: row.run_hold.missing ?? [],
      }
    : null,
});

/**
 * The parameters gates read when they match: their conditions' fields and a
 * compound command's parts. Nothing else of what an agent sent is loaded.
 */
const paramKeys = (gates: PolicyGate[]) => [
  ...new Set([
    "parts",
    ...gates.flatMap((gate) =>
      gate.conditions.map(({ field }) => field.split(".")[0] ?? field),
    ),
  ]),
];

async function loadRows(
  context: WorkspaceContext,
  args: unknown[],
  gates: PolicyGate[],
) {
  const query = (sql: string, extra: unknown[] = []) =>
    context.manager.query(sql, [...args, ...extra]);
  const runs = parseRows(
    runRow,
    await query(
      `SELECT id, key FROM nodrail.runs
       WHERE workspace_id = $1 AND id IN (${inWindow})
       ORDER BY last_activity_at DESC, id`,
    ),
  );
  const steps = parseRows(
    stepRow,
    await query(
      `SELECT run_id, step_key, agent, started_at, finished_at, verdict,
              ${usage("usd")}, ${usage("tokens")}
       FROM nodrail.run_steps
       WHERE workspace_id = $1 AND run_id IN (${inWindow})
       ORDER BY coalesce(started_at, finished_at), id`,
    ),
  );
  const actions = parseRows(
    actionRow,
    await query(
      `SELECT ar.id, ar.run_id, ar.decided_by, ar.created_at, s.agent, ar.agent_id,
              ar.installation_id, ar.tool_key, ar.operation_key,
              ar.resource_kind, ar.resource_id, ar.run_hold,
              COALESCE((SELECT jsonb_object_agg(p.key, p.value)
                        FROM jsonb_each(ar.params_safe) p
                        WHERE p.key = ANY($4::text[])), '{}') AS params_safe
       FROM nodrail.action_requests ar
       LEFT JOIN nodrail.run_steps s
         ON s.workspace_id = ar.workspace_id AND s.run_id = ar.run_id
        AND s.step_key = ar.step_key
       WHERE ar.workspace_id = $1 AND ar.run_id IN (${inWindow})
       ORDER BY ar.run_id, ar.run_seq`,
      [gates.length ? paramKeys(gates) : []],
    ),
  );
  return {
    runs,
    steps: steps.map((row) => ({
      runId: row.run_id,
      stepKey: row.step_key,
      agent: row.agent,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      verdict: row.verdict,
      usd: row.usd,
      tokens: row.tokens,
    })),
    actions: actions.map(toAction),
  };
}

/**
 * One environment's reports for the last 7, 30 or 90 days of run activity,
 * explained against the gates and budgets of the version live now.
 */
export async function getReport(
  context: WorkspaceContext,
  environmentSlug: string,
  days: ReportWindow,
): Promise<ReportDto> {
  const environment = await findEnvironment(context, environmentSlug);
  const policy = await storedRunPolicy(context, environment.id);
  const rows = await loadRows(
    context,
    [context.workspaceId, environment.id, days],
    policy.gates,
  );
  return computeReport({ ...rows, ...policy });
}
