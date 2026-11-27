/** Runs inside a transaction that has already switched to nodrail_metrics. */
export type Query = (sql: string) => Promise<unknown[]>;

export type PilotRow = {
  workspace: string;
  minutes_to_connect: number | null;
  minutes_to_first_decision: number | null;
  active_second_week: boolean;
  intents: number;
  retries: number;
  denied: number;
  emails_sent: number;
  emails_failed: number;
};

const minutesSince = (start: string, moment: string) =>
  `round((EXTRACT(EPOCH FROM ${moment} - ${start}) / 60)::numeric, 1)::float8`;

/**
 * One row per workspace. An intent is one logical call, so a retry, a status
 * poll or a check-in never makes usage look bigger than it was.
 */
export const pilotSql = `
  SELECT w.slug AS workspace,
    (SELECT ${minutesSince("w.created_at", "min(e.occurred_at)")}
     FROM nodrail.audit_events e
     WHERE e.workspace_id = w.id AND e.decision_code = 'agent_connected')
      AS minutes_to_connect,
    ${minutesSince("w.created_at", "actions.first_at")}
      AS minutes_to_first_decision,
    EXISTS (SELECT 1 FROM nodrail.action_requests ar
            WHERE ar.workspace_id = w.id AND ar.access_epoch > 0
              AND ar.created_at >= w.created_at + interval '7 days'
              AND ar.created_at < w.created_at + interval '14 days')
      AS active_second_week,
    COALESCE(actions.intents, 0) AS intents,
    COALESCE(actions.retries, 0) AS retries,
    COALESCE(actions.denied, 0) AS denied,
    COALESCE(mail.sent, 0) AS emails_sent,
    COALESCE(mail.failed, 0) AS emails_failed
  FROM nodrail.workspaces w
  LEFT JOIN LATERAL (
    SELECT min(ar.created_at) AS first_at, count(*)::int AS intents,
           sum(ar.attempt_count - 1)::int AS retries,
           count(*) FILTER (WHERE ar.initial_evaluation = 'denied')::int AS denied
    FROM nodrail.action_requests ar WHERE ar.workspace_id = w.id AND ar.access_epoch > 0
  ) actions ON true
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE o.state = 'delivered')::int AS sent,
           count(*) FILTER (WHERE o.state = 'failed')::int AS failed
    FROM nodrail.notification_outbox o WHERE o.workspace_id = w.id
  ) mail ON true
  WHERE w.archived_at IS NULL
  ORDER BY w.created_at`;

export const pilotReport = async (query: Query) =>
  (await query(pilotSql)) as PilotRow[];

const columns: [string, (row: PilotRow) => string | number | null][] = [
  ["Workspace", (row) => row.workspace],
  ["To connect (min)", (row) => row.minutes_to_connect],
  ["To 1st decision", (row) => row.minutes_to_first_decision],
  ["Week 2", (row) => (row.active_second_week ? "yes" : "no")],
  ["Intents", (row) => row.intents],
  ["Retries", (row) => row.retries],
  ["Denied", (row) => row.denied],
  ["Emails sent", (row) => row.emails_sent],
  ["Emails failed", (row) => row.emails_failed],
];

export function toMarkdown(rows: PilotRow[]) {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [
    line(columns.map(([title]) => title)),
    line(columns.map(() => "---")),
    ...rows.map((row) => line(columns.map(([, cell]) => cell(row) ?? "—"))),
  ].join("\n");
}
