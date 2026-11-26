import "server-only";
import { z } from "zod";
import type { PolicySuggestionsDto } from "@/contracts/v1/policy-impact";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import { windowStart } from "@/server/modules/insights/window";
import { findEnvironment } from "@/server/modules/workspaces";

// Names this environment has seen, offered while a policy form is filled in,
// so a rule or gate names what agents actually send and report.

/** How far back suggestions look. */
export const SUGGESTION_DAYS = 90;
const MAX_OPERATIONS = 100;
const MAX_RESOURCES = 300;
const VALUES_PER_KIND = 50;
const MAX_STEPS = 300;

const operationsSql = `
  SELECT tool_key || '.' || operation_key AS name, count(*)::int AS uses
  FROM nodrail.action_requests
  WHERE workspace_id = $1 AND environment_id = $2
    AND access_epoch > 0 AND created_at >= ${windowStart}
  GROUP BY 1 ORDER BY uses DESC, name LIMIT ${MAX_OPERATIONS}`;

const resourcesSql = `
  SELECT resource_kind AS kind, resource_id AS value, count(*)::int AS uses
  FROM nodrail.action_requests
  WHERE workspace_id = $1 AND environment_id = $2
    AND access_epoch > 0 AND created_at >= ${windowStart}
  GROUP BY 1, 2 ORDER BY uses DESC, kind, value LIMIT ${MAX_RESOURCES}`;

/** Step agents and their verdicts, in runs of this environment. */
const stepsSql = `
  SELECT s.agent, s.verdict, count(*)::int AS uses
  FROM nodrail.run_steps s
  JOIN nodrail.runs r ON r.workspace_id = s.workspace_id AND r.id = s.run_id
  WHERE s.workspace_id = $1 AND r.environment_id = $2
    AND r.last_activity_at >= ${windowStart}
  GROUP BY 1, 2 ORDER BY uses DESC, agent, verdict LIMIT ${MAX_STEPS}`;

const unique = (values: (string | null)[]) => [
  ...new Set(values.filter((value) => value !== null)),
];

/** Resource values grouped by kind, both in the order given (most used first). */
function byKind(rows: { kind: string; value: string }[]) {
  const kinds = new Map<string, string[]>();
  for (const { kind, value } of rows) {
    const values = kinds.get(kind) ?? [];
    if (values.length < VALUES_PER_KIND) values.push(value);
    kinds.set(kind, values);
  }
  return [...kinds].map(([kind, values]) => ({ kind, values }));
}

/**
 * The operations, resources, step agents and verdicts recorded in this
 * environment lately, most used first. The database shows only what this
 * person may see.
 */
export async function policySuggestions(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<PolicySuggestionsDto> {
  const { id } = await findEnvironment(context, environmentSlug);
  const query = (sql: string) =>
    context.manager.query(sql, [context.workspaceId, id, SUGGESTION_DAYS]);
  const operations = parseRows(
    z.object({ name: z.string() }),
    await query(operationsSql),
  );
  const resources = parseRows(
    z.object({ kind: z.string(), value: z.string() }),
    await query(resourcesSql),
  );
  const steps = parseRows(
    z.object({ agent: z.string(), verdict: z.string().nullable() }),
    await query(stepsSql),
  );
  return {
    operations: operations.map((row) => row.name),
    resources: byKind(resources),
    stepAgents: unique(steps.map((row) => row.agent)),
    verdicts: unique(steps.map((row) => row.verdict)),
  };
}
