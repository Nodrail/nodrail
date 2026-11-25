import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Insights: suggestions someone set aside, so they stay hidden, and the
 * environment index on actions replaced by one that adds their time
 * (action_requests_recent). Every Insights window reads
 * one environment's actions since a moment; with the index stopping at the
 * environment, that read every action it ever recorded and filtered by time.
 * The longer index still serves everything the shorter one did.
 */
export class InsightDismissals9990000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    // Fail fast rather than queue requests behind a busy action_requests.
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."insight_dismissals" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "kind" text NOT NULL, "fingerprint" text NOT NULL, "dismissed_by" uuid NOT NULL, "dismissed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_ad998f4393ba2c1b05b021cbae5" UNIQUE ("workspace_id", "environment_id", "kind", "fingerprint"), CONSTRAINT "insight_dismissals_fingerprint" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'), CONSTRAINT "insight_dismissals_kind" CHECK ("kind" IN ('repeated_approval')), CONSTRAINT "PK_10e9044eee71fc4e70b16c8418f" PRIMARY KEY ("id"))`,
    );
    await run(`DROP INDEX "nodrail"."action_requests_environment"`);
    await run(
      `CREATE INDEX "action_requests_recent" ON "nodrail"."action_requests"  ("workspace_id", "environment_id", "created_at") `,
    );
    await run(
      `ALTER TABLE "nodrail"."insight_dismissals" ADD CONSTRAINT "FK_11583996d9636aeb32744b94629" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."insight_dismissals" ADD CONSTRAINT "FK_c178a8bbafce29471b91278e149" FOREIGN KEY ("workspace_id", "dismissed_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // A tenant table like the others. Everyone in the workspace reads them: a
    // fingerprint names no agent, and the rows it hides are filtered already.
    await run(
      "ALTER TABLE nodrail.insight_dismissals ENABLE ROW LEVEL SECURITY",
    );
    await run(
      "ALTER TABLE nodrail.insight_dismissals FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE POLICY tenant ON nodrail.insight_dismissals
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(
      "GRANT SELECT ON nodrail.insight_dismissals TO nodrail_member_read",
    );
    await run(
      "GRANT SELECT, INSERT ON nodrail.insight_dismissals TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    // Its policy and grants go with the table.
    await run(
      `ALTER TABLE "nodrail"."insight_dismissals" DROP CONSTRAINT "FK_c178a8bbafce29471b91278e149"`,
    );
    await run(
      `ALTER TABLE "nodrail"."insight_dismissals" DROP CONSTRAINT "FK_11583996d9636aeb32744b94629"`,
    );
    await run(`DROP INDEX "nodrail"."action_requests_recent"`);
    await run(
      `CREATE INDEX "action_requests_environment" ON "nodrail"."action_requests"  ("workspace_id", "environment_id") `,
    );
    await run(`DROP TABLE "nodrail"."insight_dismissals"`);
  }
}
