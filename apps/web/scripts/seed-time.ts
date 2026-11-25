// Spreads the sample runs over the past months, so Insights' 7, 30 and 90
// days differ. Used by seed-runs.ts with its admin connection, locally only.
import type { DataSource } from "typeorm";

export async function clock(admin: DataSource): Promise<Date> {
  const [row]: { now: Date }[] = await admin.query(
    "SELECT clock_timestamp() AS now",
  );
  if (!row) throw new Error("No clock");
  return row.now;
}

/**
 * Moves what this seed just recorded for a run this many days back: its
 * steps, actions, permits, reports and audit events, and the run's
 * own times. Everything in a row moves by the same amount, so expiries stay
 * after creation. Earlier seeds' rows stay where they are.
 */
export async function moveBack(
  admin: DataSource,
  {
    workspaceId,
    key,
    days,
    since,
  }: { workspaceId: string; key: string; days: number; since: Date },
) {
  if (!days) return;
  await admin.transaction(async (manager) => {
    const shift = (sql: string) =>
      manager.query(sql, [workspaceId, key, days, since]);
    const runIds = `SELECT id FROM nodrail.runs
      WHERE workspace_id = $1 AND key = $2`;
    const actionIds = `SELECT id FROM nodrail.action_requests
      WHERE workspace_id = $1 AND run_id IN (${runIds}) AND created_at >= $4`;
    const back = (column: string) =>
      `${column} = ${column} - make_interval(days => $3)`;
    await shift(`UPDATE nodrail.run_steps
      SET ${back("started_at")}, ${back("finished_at")}
      WHERE workspace_id = $1 AND run_id IN (${runIds})
        AND coalesce(started_at, finished_at) >= $4`);
    for (const [table, columns, link] of [
      ["client_reports", ["received_at"], "action_request_id"],
      ["decision_permits", ["issued_at", "expires_at"], "action_request_id"],
      ["audit_events", ["occurred_at"], "action_request_id"],
      [
        "action_requests",
        ["created_at", "expires_at", "last_attempt_at"],
        "id",
      ],
    ] as const)
      await shift(`UPDATE nodrail.${table}
        SET ${columns.map(back).join(", ")}
        WHERE workspace_id = $1 AND ${link} IN (${actionIds})`);
    await shift(`UPDATE nodrail.runs
      SET ${back("last_activity_at")},
          created_at = CASE WHEN created_at >= $4
                            THEN created_at - make_interval(days => $3)
                            -- An earlier seed's run never starts after it ends.
                            ELSE LEAST(created_at, last_activity_at
                                       - make_interval(days => $3)) END
      WHERE workspace_id = $1 AND key = $2 AND last_activity_at >= $4`);
  });
}
