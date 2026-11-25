import "server-only";
import type { EntityManager } from "typeorm";
import { CONTRACT_RETENTION_DAYS } from "@/contracts/v1/declared-contracts";
import { pruneLoginState } from "@/server/auth/maintenance";
import { asMaintenance } from "@/server/db/context";
import { describeError } from "@/server/log";

const EMAIL_DAYS = 30;
const CONTENT_DAYS = 90;
const AUDIT_DETAIL_DAYS = 365;
/** A run's key and times; after that the run goes, its actions stay (R22). */
const RUN_DAYS = 365;
const BATCH = 1000;

export const EXPIRED_TEXT = "[expired]";

const olderThan = (column: string, days: number) =>
  `${column} < clock_timestamp() - make_interval(days => ${days})`;

/**
 * Runs idle for a year go, with their steps. The actions they held are what
 * was decided, so they stay and only lose the link.
 */
async function expireRuns(manager: EntityManager) {
  // A run someone holds is in use, so it is not idle; it waits for next time.
  const rows: { workspace_id: string; id: string }[] = await manager.query(
    `SELECT workspace_id, id FROM nodrail.runs
     WHERE ${olderThan("last_activity_at", RUN_DAYS)}
     ORDER BY last_activity_at
     LIMIT ${BATCH}
     FOR UPDATE SKIP LOCKED`,
  );
  if (!rows.length) return 0;
  const runs = JSON.stringify(rows);
  const doomed = `SELECT workspace_id, id
    FROM jsonb_to_recordset($1::jsonb) AS doomed(workspace_id uuid, id uuid)`;
  await manager.query(
    `UPDATE nodrail.action_requests
     SET run_id = NULL, step_key = NULL, run_seq = NULL
     WHERE (workspace_id, run_id) IN (${doomed})`,
    [runs],
  );
  await manager.query(
    `DELETE FROM nodrail.run_steps WHERE (workspace_id, run_id) IN (${doomed})`,
    [runs],
  );
  await manager.query(
    `DELETE FROM nodrail.runs WHERE (workspace_id, id) IN (${doomed})`,
    [runs],
  );
  return rows.length;
}

/** A contract revision or projection that something still names. */
const named = (table: string, column: string) =>
  `EXISTS (SELECT 1 FROM nodrail.${table} n
           WHERE n.workspace_id = r.workspace_id AND n.surface = r.surface
             AND n.${column} = r.digest)`;

/**
 * Declared contracts: events go after a year, like local runs; a binding
 * once a later workspace revision of its project replaced it a year ago;
 * a revision or projection once nothing names it, so history keeps the
 * schema it was validated against for as long as the history lasts.
 */
async function expireContracts(run: (sql: string) => Promise<number>) {
  const unnamed = (table: string, referrers: string[]) =>
    run(
      `DELETE FROM nodrail.${table} WHERE id IN (
         SELECT r.id FROM nodrail.${table} r
         WHERE ${olderThan("r.created_at", CONTRACT_RETENTION_DAYS)}
           AND NOT (${referrers.join(" OR ")})
         LIMIT ${BATCH})`,
    );
  const contractEvents = await run(
    `DELETE FROM nodrail.contract_events WHERE id IN (
       SELECT id FROM nodrail.contract_events
       WHERE ${olderThan("received_at", CONTRACT_RETENTION_DAYS)}
       LIMIT ${BATCH})`,
  );
  // A published revision's pins, a year after a later one replaced them.
  const replaced = (table: string) =>
    run(
      `DELETE FROM nodrail.${table} WHERE id IN (
         SELECT p.id FROM nodrail.${table} p
         WHERE ${olderThan("p.published_at", CONTRACT_RETENTION_DAYS)}
           AND EXISTS (SELECT 1 FROM nodrail.${table} later
                       WHERE later.workspace_id = p.workspace_id
                         AND later.environment_id = p.environment_id
                         AND later.project_id = p.project_id
                         AND later.workspace_revision <> p.workspace_revision
                         AND later.published_at > p.published_at)
         LIMIT ${BATCH})`,
    );
  const contractBindings = await replaced("contract_bindings");
  // What a revision pinned about evidence goes as its bindings do.
  const evidenceBindings = await replaced("evidence_bindings");
  const evidenceRequirements = await replaced("evidence_requirements");
  // A token can't be used once expired; a day later its use is forgotten.
  const evidenceTokenUses = await run(
    `DELETE FROM nodrail.evidence_token_uses WHERE id IN (
       SELECT id FROM nodrail.evidence_token_uses
       WHERE ${olderThan("expires_at", 1)}
       LIMIT ${BATCH})`,
  );
  const contractProjections = await unnamed("contract_projections", [
    named("contract_events", "projection_digest"),
    named("contract_bindings", "projection_digest"),
  ]);
  const contractRevisions = await unnamed("contract_revisions", [
    named("contract_events", "contract_digest"),
    named("contract_bindings", "contract_digest"),
    named("contract_projections", "contract_digest"),
  ]);
  return {
    contractEvents,
    contractBindings,
    contractProjections,
    contractRevisions,
    evidenceBindings,
    evidenceRequirements,
    evidenceTokenUses,
  };
}

/** How many rows one statement changed. */
async function changed(manager: EntityManager, sql: string) {
  const [, count]: [unknown, number] = await manager.query(sql);
  return count;
}

/**
 * Runs and their steps, in a transaction of their own: if this fails, the
 * rest of retention, including email, has already happened.
 */
async function runRetention() {
  try {
    return await asMaintenance(async (manager) => ({
      steps: await changed(
        manager,
        // A declared receipt's values go too; its state and issues stay.
        `UPDATE nodrail.run_steps
         SET receipt = CASE WHEN receipt ? 'contract'
                         THEN jsonb_set(receipt - 'findings', '{contract,value}', 'null')
                         ELSE receipt - 'findings' END
         WHERE id IN (
           SELECT id FROM nodrail.run_steps
           WHERE receipt ? 'findings'
             AND ${olderThan("coalesce(finished_at, started_at)", CONTENT_DAYS)}
           LIMIT ${BATCH})`,
      ),
      runs: await expireRuns(manager),
    }));
  } catch (error) {
    console.error("Run retention failed", describeError(error));
    return { steps: null, runs: null };
  }
}

/**
 * Removes what a person or agent wrote once it has served its purpose. What was
 * decided, when and by whom stays. Batched, so a backlog clears over several runs.
 */
export async function applyRetention() {
  const rest = await asMaintenance(async (manager) => {
    const run = (sql: string) => changed(manager, sql);
    return {
      emails: await run(
        `DELETE FROM nodrail.notification_outbox WHERE id IN (
           SELECT id FROM nodrail.notification_outbox
           WHERE state IN ('delivered', 'failed', 'dropped')
             AND ${olderThan("created_at", EMAIL_DAYS)}
           LIMIT ${BATCH})`,
      ),
      actions: await run(
        `UPDATE nodrail.action_requests
         SET params_safe = '{}', resource_id = '${EXPIRED_TEXT}',
             host_reason = NULL
         WHERE id IN (
           SELECT id FROM nodrail.action_requests
           WHERE resource_id <> '${EXPIRED_TEXT}'
             AND ${olderThan("created_at", CONTENT_DAYS)}
           LIMIT ${BATCH})`,
      ),
      observed: await run(
        `UPDATE nodrail.observed_permissions
         SET resource_label = '${EXPIRED_TEXT}'
         WHERE id IN (
           SELECT id FROM nodrail.observed_permissions
           WHERE resource_label <> '${EXPIRED_TEXT}'
             AND ${olderThan("last_seen_at", CONTENT_DAYS)}
           LIMIT ${BATCH})`,
      ),
      reports: await run(
        `UPDATE nodrail.client_reports SET details_safe = '{}'
         WHERE id IN (
           SELECT id FROM nodrail.client_reports
           WHERE details_safe <> '{}'
             AND ${olderThan("received_at", CONTENT_DAYS)}
           LIMIT ${BATCH})`,
      ),
      // What installations reported their hooks did: a year, like runs.
      reported: await run(
        `DELETE FROM nodrail.reported_events WHERE id IN (
           SELECT id FROM nodrail.reported_events
           WHERE ${olderThan("received_at", RUN_DAYS)}
           LIMIT ${BATCH})`,
      ),
      ...(await expireContracts(run)),
      audit: await run(
        `UPDATE nodrail.audit_events SET payload_safe = '{}'
         WHERE id IN (
           SELECT id FROM nodrail.audit_events
           WHERE payload_safe <> '{}'
             AND ${olderThan("occurred_at", AUDIT_DETAIL_DAYS)}
           LIMIT ${BATCH})`,
      ),
    };
  });
  return { ...rest, ...(await runRetention()), ...(await pruneLoginState()) };
}
