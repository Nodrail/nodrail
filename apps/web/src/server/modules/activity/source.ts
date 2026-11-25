import "server-only";
import { z } from "zod";
import {
  activityCatalog,
  describeActivity,
  type ActivityEventDto,
  type ActivityOutcome,
  type DecisionCode,
} from "@/contracts/v1/activity";
import {
  rangeIntervals,
  type ActivityQuery,
} from "@/contracts/v1/activity-query";
import {
  requestReference,
  withoutReferencePrefix,
} from "@/contracts/v1/requests";
import { decidedOnHost } from "@/contracts/v1/runs";
import {
  AppError,
  decodeCursor,
  encodeCursor,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import { reportMismatch } from "./mismatch";

export const eventRow = z.object({
  id: z.uuid(),
  occurred_at: z.date(),
  cursor_at: z.string(),
  decision_code: z.string(),
  actor_kind: z.enum(["human", "runtime", "system"]),
  actor_name: z.string().nullable(),
  actor_token_name: z.string().nullable(),
  external_key: z.string().nullable(),
  action_id: z.uuid().nullable(),
  tool_key: z.string().nullable(),
  operation_key: z.string().nullable(),
  resource_kind: z.string().nullable(),
  resource_id: z.string().nullable(),
  installation_name: z.string().nullable(),
  run_id: z.uuid().nullable(),
  run_key: z.string().nullable(),
  environment_name: z.string().nullable(),
  logical_rule_id: z.uuid().nullable(),
  rule_name: z.string().nullable(),
  policy_revision: z.number().nullable(),
  payload_safe: z.object({
    subject: z.string().optional(),
    detail: z.string().optional(),
    hold: z
      .object({ kind: z.enum(["gate", "budget"]), name: z.string() })
      .optional(),
  }),
  report_outcome: z.enum(["success", "failure", "unknown"]).nullable(),
  report_at: z.date().nullable(),
  report_mismatch: z.boolean(),
  decided_on_host: z.boolean().nullable(),
  policy_digest: z.string().nullable(),
  policy_skew: z.boolean().nullable(),
});

export type EventRow = z.infer<typeof eventRow>;

/**
 * The audit log: every decision and change as it was recorded. Nothing
 * waits for a person, so every event is one that happened. Screens read
 * this through per-person row level security.
 */
export const eventSource = `
  WITH events AS (
    SELECT e.id, e.occurred_at, e.decision_code, e.actor_kind, e.actor_user_id,
           e.actor_token_id, e.action_request_id, e.agent_id, e.environment_id, e.policy_version_id,
           e.matched_logical_rule_id, e.payload_safe
    FROM nodrail.audit_events e
    WHERE e.workspace_id = $1 AND (e.environment_id = $2 OR e.environment_id IS NULL)
  )
  SELECT ev.id, ev.occurred_at, ev.occurred_at::text AS cursor_at,
         ev.decision_code, ev.actor_kind, u.display_name AS actor_name,
         token.name AS actor_token_name,
         a.external_key, ar.id AS action_id, ar.tool_key, ar.operation_key,
         ar.resource_kind, ar.resource_id, i.name AS installation_name,
         run.id AS run_id, run.key AS run_key,
         ar.decided_by = 'host' AS decided_on_host, ar.policy_digest, ar.policy_skew,
         env.name AS environment_name,
         ev.matched_logical_rule_id AS logical_rule_id,
         -- A gate or budget isn't a rule row; its audit event names it.
         COALESCE(rule.name, ev.payload_safe->'hold'->>'name') AS rule_name,
         pv.revision AS policy_revision, ev.payload_safe,
         report.outcome AS report_outcome, report.received_at AS report_at,
         verdict.mismatch AS report_mismatch
  FROM events ev
  LEFT JOIN nodrail.users u ON u.id = ev.actor_user_id
  LEFT JOIN nodrail.personal_access_tokens token
    ON token.workspace_id = $1 AND token.id = ev.actor_token_id
  LEFT JOIN nodrail.agents a ON a.workspace_id = $1 AND a.id = ev.agent_id
  LEFT JOIN nodrail.action_requests ar
    ON ar.workspace_id = $1 AND ar.id = ev.action_request_id
  LEFT JOIN nodrail.installations i
    ON i.workspace_id = $1 AND i.id = ar.installation_id
  LEFT JOIN nodrail.runs run ON run.workspace_id = $1 AND run.id = ar.run_id
  LEFT JOIN nodrail.environments env
    ON env.workspace_id = $1 AND env.id = ev.environment_id
  LEFT JOIN nodrail.policy_versions pv
    ON pv.workspace_id = $1 AND pv.id = ev.policy_version_id
  LEFT JOIN LATERAL (
    -- The name the rule had at this event. A revoked rule is not in the
    -- version that removed it, so that falls back to its last revision.
    SELECT r.name FROM nodrail.policy_rules r
    WHERE r.workspace_id = $1 AND r.logical_rule_id = ev.matched_logical_rule_id
    ORDER BY (r.policy_version_id = ev.policy_version_id) DESC, r.rule_revision DESC
    LIMIT 1
  ) rule ON true
  LEFT JOIN LATERAL (
    SELECT c.outcome, c.received_at FROM nodrail.client_reports c
    WHERE c.workspace_id = $1 AND c.action_request_id = ar.id
    ORDER BY c.received_at DESC, c.id DESC
    LIMIT 1
  ) report ON true
  LEFT JOIN LATERAL (
    SELECT ${reportMismatch("ar.id", "$1")} AS mismatch
  ) verdict ON true`;

/** The action an event is about, when there is one and it may be seen. */
function actionOf(row: EventRow): ActivityEventDto["action"] {
  if (
    !row.action_id ||
    !row.tool_key ||
    !row.operation_key ||
    !row.resource_kind ||
    !row.resource_id ||
    !row.installation_name
  )
    return null;
  return {
    toolKey: row.tool_key,
    operationKey: row.operation_key,
    resourceKind: row.resource_kind,
    resource: row.resource_id,
    installationName: row.installation_name,
    run:
      row.run_id && row.run_key ? { id: row.run_id, key: row.run_key } : null,
    reference: requestReference(row.action_id),
  };
}

/** The rule behind a decision, or the gate or budget that held the action. */
const ruleOf = (row: EventRow): ActivityEventDto["rule"] =>
  row.logical_rule_id
    ? {
        kind: row.payload_safe.hold?.kind ?? "rule",
        id: row.logical_rule_id,
        name: row.rule_name,
        revision: row.policy_revision,
      }
    : null;

export function toEvent(row: EventRow): ActivityEventDto {
  const { group, outcome, label } = describeActivity(row.decision_code);
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    code: row.decision_code,
    group,
    outcome,
    label,
    actor: {
      kind: row.actor_kind,
      name: row.actor_name,
      ...(row.actor_token_name ? { via: row.actor_token_name } : {}),
    },
    agentKey: row.external_key,
    action: actionOf(row),
    environment: row.environment_name,
    rule: ruleOf(row),
    subject: row.payload_safe.subject ?? null,
    detail: row.payload_safe.detail ?? null,
    latestReport:
      row.report_outcome && row.report_at
        ? {
            outcome: row.report_outcome,
            receivedAt: row.report_at.toISOString(),
            mismatch: row.report_mismatch,
          }
        : null,
    ...decidedOnHost(row),
  };
}

const catalogEntries = Object.entries(activityCatalog) as [
  DecisionCode,
  (typeof activityCatalog)[DecisionCode],
][];

const codesWhere = (
  matches: (entry: (typeof catalogEntries)[number][1]) => boolean,
) => catalogEntries.filter(([, entry]) => matches(entry)).map(([code]) => code);

const codesForKind = {
  decisions: codesWhere((entry) => entry.group === "decision"),
  changes: codesWhere((entry) => entry.group === "change"),
};

export const codesForOutcome = (outcome: ActivityOutcome) =>
  codesWhere((entry) => entry.outcome === outcome);

/** Search terms are literal text, never patterns. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

const searchTerm = (q: string) =>
  q ? `%${escapeLike(withoutReferencePrefix(q))}%` : null;

const uuid = z.uuid();

/** A run filter names a run; anything else is a page that does not exist. */
export function runFilter(run: string) {
  if (run && !uuid.safeParse(run).success) throw new AppError("NOT_FOUND");
  return run || null;
}

export const sinceFor = (range: ActivityQuery["range"]) =>
  range === "all" ? null : rangeIntervals[range];

/** The query's filters as the parameters of `eventsWhere`, from `$3`. */
function eventFilters(query: ActivityQuery) {
  const { kind, outcome } = query;
  const byOutcome =
    outcome === "all" || outcome === "held" ? null : codesForOutcome(outcome);
  return [
    kind === "decisions" || kind === "changes" ? codesForKind[kind] : null,
    byOutcome,
    kind === "reports" || kind === "mismatches" ? kind : null,
    outcome === "held",
    searchTerm(query.q),
    query.agent || null,
    runFilter(query.run),
    sinceFor(query.range),
  ];
}

const eventsWhere = `
  WHERE ($3::text[] IS NULL OR ev.decision_code = ANY($3))
    AND ($4::text[] IS NULL OR ev.decision_code = ANY($4))
    AND ($5::text IS NULL
         OR ($5 = 'reports' AND report.outcome IS NOT NULL)
         OR ($5 = 'mismatches' AND verdict.mismatch))
    -- Held: a gate or budget stopped this action, whatever was decided next.
    AND (NOT $6::boolean OR ar.run_hold IS NOT NULL
         OR ev.payload_safe->'hold' IS NOT NULL)
    AND ($7::text IS NULL OR concat_ws(' ',
          a.external_key, i.name, ar.tool_key || '.' || ar.operation_key,
          ar.resource_id, ar.id::text, run.key,
          COALESCE(rule.name, ev.payload_safe->'hold'->>'name'), u.display_name,
          token.name
        ) ILIKE $7)
    AND ($8::text IS NULL OR a.external_key = $8)
    AND ($9::uuid IS NULL OR run.id = $9)
    AND ($10::interval IS NULL OR ev.occurred_at >= clock_timestamp() - $10::interval)
    AND ($11::timestamptz IS NULL
         OR (ev.occurred_at, ev.id) < ($11::timestamptz, $12::uuid))
  ORDER BY ev.occurred_at DESC, ev.id DESC
  LIMIT $13`;

/** One page of events matching the query, newest first, and the cursor to the next. */
export async function queryEvents(
  context: WorkspaceContext,
  environmentId: string,
  query: ActivityQuery,
  options: { limit: number },
) {
  const cursor = decodeCursor(query.cursor);
  const rows = parseRows(
    eventRow,
    await context.manager.query(`${eventSource} ${eventsWhere}`, [
      context.workspaceId,
      environmentId,
      ...eventFilters(query),
      cursor.at,
      cursor.id,
      options.limit + 1,
    ]),
  );
  const page = rows.slice(0, options.limit);
  const last = page.at(-1);
  return {
    items: page.map(toEvent),
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor(last.cursor_at, last.id)
        : null,
  };
}
