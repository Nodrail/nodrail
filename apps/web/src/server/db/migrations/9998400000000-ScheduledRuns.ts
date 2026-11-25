import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * When each scheduled job (delivery, retries, retention) last ran, so an
 * operator can see it happens: self-hosted deployments run their own
 * scheduler. No workspace data; only the maintenance role reads or writes
 * it, and an error is kept as its code.
 */
export class ScheduledRuns9998400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      `CREATE TABLE "nodrail"."scheduled_runs" ("job" text NOT NULL, "last_started_at" TIMESTAMP WITH TIME ZONE, "last_succeeded_at" TIMESTAMP WITH TIME ZONE, "last_failed_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "runs" integer NOT NULL DEFAULT '0', CONSTRAINT "scheduled_runs_error" CHECK (length("last_error") <= 100), CONSTRAINT "scheduled_runs_job" CHECK ("job" ~ '^[a-z][a-z0-9-]{0,39}$'), CONSTRAINT "PK_5a91177eaf20a44064e052d4a09" PRIMARY KEY ("job"))`,
    );
    // Like every table: row security forced, open only to maintenance.
    await run("ALTER TABLE nodrail.scheduled_runs ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.scheduled_runs FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY maintenance ON nodrail.scheduled_runs
        FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
    `);
    await run(
      "GRANT SELECT, INSERT, UPDATE ON nodrail.scheduled_runs TO nodrail_maintenance",
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`DROP TABLE "nodrail"."scheduled_runs"`);
  }
}
