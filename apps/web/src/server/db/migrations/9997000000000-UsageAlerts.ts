import type { MigrationInterface, QueryRunner } from "typeorm";

const kinds = (list: string[]) =>
  `CHECK ("kind" IN (${list.map((item) => `'${item}'`).join(", ")}))`;

const before = ["approval_requested", "new_permission", "integration_stale"];

/**
 * Usage alerts: a row per workspace, UTC month, metric and threshold reached
 * (80 % and 100 % of actions or run steps), whose key keeps each email from
 * being sent twice; the outbox kind that carries them; and each person's
 * choice to receive them, on like the others until turned off.
 */
export class UsageAlerts9997000000000 implements MigrationInterface {
  name = "UsageAlerts9997000000000";

  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    // Fail fast rather than queue requests behind a busy outbox.
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."usage_alerts" ("workspace_id" uuid NOT NULL, "period" date NOT NULL, "metric" text NOT NULL, "threshold" smallint NOT NULL, "used" integer NOT NULL, "allowance" integer NOT NULL, "notified_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "usage_alerts_threshold" CHECK ("threshold" IN (80, 100)), CONSTRAINT "usage_alerts_metric" CHECK ("metric" IN ('actions', 'steps')), CONSTRAINT "PK_38cc9254034e68c96d35db834bb" PRIMARY KEY ("workspace_id", "period", "metric", "threshold"))`,
    );
    await run(
      `ALTER TABLE "nodrail"."usage_alerts" ADD CONSTRAINT "FK_bb662684a61861f5e17c52e403e" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."notification_preferences" ADD "usage_alerts" boolean NOT NULL DEFAULT true`,
    );
    await run(
      `ALTER TABLE "nodrail"."notification_outbox" DROP CONSTRAINT "notification_kind"`,
    );
    await run(
      `ALTER TABLE "nodrail"."notification_outbox" ADD CONSTRAINT "notification_kind" ${kinds([...before, "usage_alert"])}`,
    );

    // A tenant table like the others. Its numbers are the ones every member
    // already sees on Overview, so everyone in the workspace may read them.
    await run("ALTER TABLE nodrail.usage_alerts ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.usage_alerts FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY tenant ON nodrail.usage_alerts
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run("GRANT SELECT ON nodrail.usage_alerts TO nodrail_member_read");
    await run("GRANT SELECT, INSERT ON nodrail.usage_alerts TO nodrail_app");
    await run(
      "GRANT UPDATE (usage_alerts) ON nodrail.notification_preferences TO nodrail_app",
    );
  }

  /** Refused while the outbox holds a usage alert: those rows are not rewritten. */
  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      "REVOKE UPDATE (usage_alerts) ON nodrail.notification_preferences FROM nodrail_app",
    );
    await run(
      `ALTER TABLE "nodrail"."notification_outbox" DROP CONSTRAINT "notification_kind"`,
    );
    await run(
      `ALTER TABLE "nodrail"."notification_outbox" ADD CONSTRAINT "notification_kind" ${kinds(before)}`,
    );
    await run(
      `ALTER TABLE "nodrail"."notification_preferences" DROP COLUMN "usage_alerts"`,
    );
    // Its policy and grants go with the table.
    await run(
      `ALTER TABLE "nodrail"."usage_alerts" DROP CONSTRAINT "FK_bb662684a61861f5e17c52e403e"`,
    );
    await run(`DROP TABLE "nodrail"."usage_alerts"`);
  }
}
