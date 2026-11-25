import type { MigrationInterface, QueryRunner } from "typeorm";

/** Exactly the columns a usage report needs. No names, addresses or content. */
const readable: Record<string, string> = {
  workspaces: "id, slug, created_at, archived_at",
  installations: "workspace_id, id",
  action_requests:
    "workspace_id, id, installation_id, permission_fingerprint, created_at, attempt_count, initial_evaluation",
  approval_requests:
    "workspace_id, action_request_id, state, created_at, decided_at, expires_at",
  audit_events: "workspace_id, occurred_at, decision_code",
  notification_outbox: "workspace_id, state",
};

export class MetricsRole9300000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_metrics') THEN
          CREATE ROLE nodrail_metrics NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$
    `);
    await run(
      "GRANT nodrail_metrics TO nodrail_app WITH INHERIT FALSE, SET TRUE",
    );
    await run("GRANT USAGE ON SCHEMA nodrail TO nodrail_metrics");
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.current_workspace_id() TO nodrail_metrics",
    );
    for (const [table, columns] of Object.entries(readable)) {
      await run(
        `GRANT SELECT (${columns}) ON nodrail.${table} TO nodrail_metrics`,
      );
      await run(`
        CREATE POLICY metrics_read ON nodrail.${table}
          FOR SELECT TO nodrail_metrics USING (true)
      `);
    }
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const [table, columns] of Object.entries(readable)) {
      await run(`DROP POLICY metrics_read ON nodrail.${table}`);
      await run(
        `REVOKE SELECT (${columns}) ON nodrail.${table} FROM nodrail_metrics`,
      );
    }
    await run(
      "REVOKE EXECUTE ON FUNCTION nodrail.current_workspace_id() FROM nodrail_metrics",
    );
    await run("REVOKE USAGE ON SCHEMA nodrail FROM nodrail_metrics");
    await run("REVOKE nodrail_metrics FROM nodrail_app");
  }
}
