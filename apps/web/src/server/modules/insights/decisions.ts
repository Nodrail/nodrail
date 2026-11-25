import "server-only";
import { z } from "zod";
import type {
  DecisionMetricsDto,
  RuleMetricsDto,
  RuleUsageDto,
} from "@/contracts/v1/insights";
import type { Effect } from "@/contracts/v1/policies";
import type { ReportWindow } from "@/contracts/v1/reports";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import { windowArgs, windowStart } from "./window";

/** The most-used rules shown, and the unused ones listed. */
const TOP_RULES = 5;
const UNUSED_RULES = 20;

/**
 * The window's actions: allowed, denied, and denied because no rule covered
 * them. Every one was decided by the rules; nothing waited for a person.
 */
const decisionsSql = `
  SELECT count(ar.id)::int AS actions,
         count(*) FILTER (WHERE ar.initial_evaluation = 'ready')::int AS allowed,
         count(*) FILTER (WHERE ar.initial_evaluation = 'denied')::int AS denied,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM nodrail.audit_events e
           WHERE e.workspace_id = ar.workspace_id
             AND e.action_request_id = ar.id
             AND e.decision_code = 'denied_no_rule'))::int AS no_rule
  FROM nodrail.action_requests ar
  WHERE ar.workspace_id = $1 AND ar.environment_id = $2
    AND ar.created_at >= ${windowStart}`;

const decisionsRow = z.object({
  actions: z.number(),
  allowed: z.number(),
  denied: z.number(),
  no_rule: z.number(),
});

/** The window's actions, by what the rules decided. */
export async function getDecisionMetrics(
  context: WorkspaceContext,
  environmentSlug: string,
  days: ReportWindow,
): Promise<DecisionMetricsDto> {
  const { args } = await windowArgs(context, environmentSlug, days);
  const [row] = parseRows(
    decisionsRow,
    await context.manager.query(decisionsSql, args),
  );
  if (!row) throw new Error("An aggregate always returns a row");
  return {
    actions: row.actions,
    allowed: row.allowed,
    denied: row.denied,
    noRule: row.no_rule,
  };
}

/**
 * The active rules, with how often each decided in the window. A match is a
 * decision record naming the rule: a denial, or a permit it allowed.
 * `whole_window` is false for a rule first
 * published inside the window, which has not had the whole of it to match.
 */
const rulesSql = `
  WITH matches AS (
    SELECT e.matched_logical_rule_id AS id, count(*)::int AS matches,
           max(e.occurred_at) AS last_at
    FROM nodrail.audit_events e
    WHERE e.workspace_id = $1 AND e.environment_id = $2
      AND e.occurred_at >= ${windowStart}
      AND e.event_type IN ('authorization.decided', 'authorization.permit_issued')
      AND e.matched_logical_rule_id IS NOT NULL
    GROUP BY e.matched_logical_rule_id
  )
  SELECT r.logical_rule_id, r.name, r.effect,
         COALESCE(m.matches, 0) AS matches, m.last_at,
         (SELECT min(o.updated_at) FROM nodrail.policy_rules o
          WHERE o.workspace_id = r.workspace_id
            AND o.logical_rule_id = r.logical_rule_id) < ${windowStart}
           AS whole_window
  FROM nodrail.policy_rules r
  JOIN nodrail.active_policies a
    ON a.workspace_id = r.workspace_id
   AND a.policy_version_id = r.policy_version_id
  LEFT JOIN matches m ON m.id = r.logical_rule_id
  WHERE r.workspace_id = $1 AND a.environment_id = $2
    AND (r.expires_at IS NULL OR r.expires_at > clock_timestamp())
  ORDER BY matches DESC, r.name, r.logical_rule_id`;

const ruleRow = z.object({
  logical_rule_id: z.uuid(),
  name: z.string(),
  effect: z.custom<Effect>(),
  matches: z.number(),
  last_at: z.date().nullable(),
  whole_window: z.boolean(),
});

const toUsage = (row: z.infer<typeof ruleRow>): RuleUsageDto => ({
  logicalRuleId: row.logical_rule_id,
  name: row.name,
  effect: row.effect,
  matches: row.matches,
  lastMatchedAt: row.last_at?.toISOString() ?? null,
});

/** Which rules do the work, which never match, and how much they decide. */
export async function getRuleMetrics(
  context: WorkspaceContext,
  environmentSlug: string,
  days: ReportWindow,
): Promise<RuleMetricsDto> {
  const { args } = await windowArgs(context, environmentSlug, days);
  const rows = parseRows(ruleRow, await context.manager.query(rulesSql, args));
  const decisions = await getDecisionMetrics(context, environmentSlug, days);
  const unused = rows.filter((row) => row.matches === 0);
  return {
    top: rows
      .filter((row) => row.matches > 0)
      .slice(0, TOP_RULES)
      .map(toUsage),
    unused: unused
      .filter((row) => row.whole_window)
      .slice(0, UNUSED_RULES)
      .map(toUsage),
    newer: unused.filter((row) => !row.whole_window).length,
    activeRules: rows.length,
    decided: {
      count: decisions.actions - decisions.noRule,
      of: decisions.actions,
    },
  };
}
