import type { MigrationInterface, QueryRunner } from "typeorm";

/** Who may read and write runs, written by hand as in the access-control migration. */
const tables = ["runs", "run_steps"];

/** Per-person limits for the role screens read through, like action requests. */
const memberScope: Record<string, string> = {
  run_steps: "installation_id IN (SELECT id FROM nodrail.installations)",
  runs: "installation_id IN (SELECT id FROM nodrail.installations)",
};

/**
 * Runs, their steps, and the gates and budgets of each policy version. An
 * action request already records a tool call, so it gains its run and step,
 * its place in the run, and whether it changes anything.
 */
export class Runs9950000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    // Runs in the deploy's transaction: if a busy table can't be locked
    // quickly, fail and retry the deploy rather than queue every request
    // behind it. The new columns are empty, so checking their constraints is
    // one pass over action_requests under the lock this transaction already
    // holds; NOT VALID followed by VALIDATE would save nothing here.
    await run("SET LOCAL lock_timeout = '5s'");
    // Numbers every step and action of every run; see `OptionalSeq`.
    await run("CREATE SEQUENCE nodrail.run_events AS bigint");
    await run(
      `CREATE TABLE "nodrail"."runs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "key" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "last_activity_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_108e1d24a78de8057056d55689c" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_f3bb49a931dc1445d6ac3dbf655" UNIQUE ("workspace_id", "environment_id", "installation_id", "key"), CONSTRAINT "runs_key" CHECK (length("key") BETWEEN 1 AND 200), CONSTRAINT "PK_46d6a1e257c38ba58f1a3c30836" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "runs_installation" ON "nodrail"."runs"  ("workspace_id", "installation_id") `,
    );
    await run(
      `CREATE INDEX "runs_recent" ON "nodrail"."runs"  ("workspace_id", "environment_id", "last_activity_at") `,
    );
    await run(
      `CREATE TABLE "nodrail"."run_steps" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "run_id" uuid NOT NULL, "step_key" text NOT NULL, "agent" text NOT NULL, "installation_id" uuid NOT NULL, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "started_seq" bigint, "finished_seq" bigint, "verdict" text, "receipt" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "UQ_f3ad5321116ae68f27e9d91d6c2" UNIQUE ("workspace_id", "run_id", "step_key"), CONSTRAINT "run_steps_finished" CHECK (("finished_at" IS NULL) = ("finished_seq" IS NULL)), CONSTRAINT "run_steps_started" CHECK (("started_at" IS NULL) = ("started_seq" IS NULL)), CONSTRAINT "run_steps_receipt" CHECK (pg_column_size("receipt") <= 4096), CONSTRAINT "run_steps_verdict" CHECK ("verdict" IS NULL OR "finished_at" IS NOT NULL), CONSTRAINT "run_steps_agent" CHECK ("agent" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'), CONSTRAINT "run_steps_key" CHECK (length("step_key") BETWEEN 1 AND 200), CONSTRAINT "PK_2715c16961bdba2e3f7632da164" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "run_steps_installation" ON "nodrail"."run_steps"  ("workspace_id", "installation_id") `,
    );
    await run(`ALTER TABLE "nodrail"."policy_versions" ADD "run_policy" jsonb`);
    await run(`ALTER TABLE "nodrail"."action_requests" ADD "run_id" uuid`);
    await run(`ALTER TABLE "nodrail"."action_requests" ADD "step_key" text`);
    await run(`ALTER TABLE "nodrail"."action_requests" ADD "run_seq" bigint`);
    await run(
      `ALTER TABLE "nodrail"."action_requests" ADD "run_change" boolean`,
    );
    await run(`ALTER TABLE "nodrail"."action_requests" ADD "run_hold" jsonb`);
    await run(
      `CREATE INDEX "action_requests_run" ON "nodrail"."action_requests"  ("workspace_id", "run_id", "run_seq") WHERE "run_id" IS NOT NULL`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "action_requests_run_seq" CHECK (("run_id" IS NULL) = ("run_seq" IS NULL))`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "action_requests_step" CHECK ("step_key" IS NULL OR "run_id" IS NOT NULL)`,
    );
    await run(
      `ALTER TABLE "nodrail"."runs" ADD CONSTRAINT "FK_28544a2fd8e9415f57721b93a61" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."runs" ADD CONSTRAINT "FK_6e97fa09639677d4a40f049bf04" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."run_steps" ADD CONSTRAINT "FK_4bf77fd6252ddcf04edbe88cf99" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "nodrail"."runs"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."run_steps" ADD CONSTRAINT "FK_86acd6b38e4a0e6ff7ae4e441f3" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "FK_232798b6e94e8daba0dc0c52247" FOREIGN KEY ("run_id", "workspace_id") REFERENCES "nodrail"."runs"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "FK_7cec4fc496583d5375917cd827e" FOREIGN KEY ("workspace_id", "run_id", "step_key") REFERENCES "nodrail"."run_steps"("workspace_id","run_id","step_key") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    for (const table of tables) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
      await run(`GRANT SELECT ON nodrail.${table} TO nodrail_member_read`);
      await run(`GRANT SELECT, INSERT ON nodrail.${table} TO nodrail_app`);
    }
    for (const [table, predicate] of Object.entries(memberScope))
      await run(`
        CREATE POLICY member_scope ON nodrail.${table}
          AS RESTRICTIVE FOR SELECT TO nodrail_member_read
          USING (${predicate})
      `);
    await run("GRANT UPDATE (last_activity_at) ON nodrail.runs TO nodrail_app");
    await run(
      "GRANT UPDATE (started_at, started_seq, finished_at, finished_seq, verdict, receipt) ON nodrail.run_steps TO nodrail_app",
    );
    await run("GRANT USAGE ON SEQUENCE nodrail.run_events TO nodrail_app");
    // A change moves to when it went ahead; see `placeWhenAhead`.
    await run(
      "GRANT UPDATE (run_seq) ON nodrail.action_requests TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    // The tables go below, and their policies and grants with them.
    await run(
      "REVOKE UPDATE (run_seq) ON nodrail.action_requests FROM nodrail_app",
    );
    for (const table of Object.keys(memberScope))
      await run(`DROP POLICY member_scope ON nodrail.${table}`);
    await run(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "FK_7cec4fc496583d5375917cd827e"`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "FK_232798b6e94e8daba0dc0c52247"`,
    );
    await run(
      `ALTER TABLE "nodrail"."run_steps" DROP CONSTRAINT "FK_86acd6b38e4a0e6ff7ae4e441f3"`,
    );
    await run(
      `ALTER TABLE "nodrail"."run_steps" DROP CONSTRAINT "FK_4bf77fd6252ddcf04edbe88cf99"`,
    );
    await run(
      `ALTER TABLE "nodrail"."runs" DROP CONSTRAINT "FK_6e97fa09639677d4a40f049bf04"`,
    );
    await run(
      `ALTER TABLE "nodrail"."runs" DROP CONSTRAINT "FK_28544a2fd8e9415f57721b93a61"`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "action_requests_step"`,
    );
    await run(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "action_requests_run_seq"`,
    );
    await run(`DROP INDEX "nodrail"."action_requests_run"`);
    await run(`ALTER TABLE "nodrail"."action_requests" DROP COLUMN "run_hold"`);
    await run(
      `ALTER TABLE "nodrail"."action_requests" DROP COLUMN "run_change"`,
    );
    await run(`ALTER TABLE "nodrail"."action_requests" DROP COLUMN "run_seq"`);
    await run(`ALTER TABLE "nodrail"."action_requests" DROP COLUMN "step_key"`);
    await run(`ALTER TABLE "nodrail"."action_requests" DROP COLUMN "run_id"`);
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "run_policy"`,
    );
    await run(`DROP INDEX "nodrail"."run_steps_installation"`);
    await run(`DROP TABLE "nodrail"."run_steps"`);
    await run(`DROP INDEX "nodrail"."runs_recent"`);
    await run(`DROP INDEX "nodrail"."runs_installation"`);
    await run(`DROP TABLE "nodrail"."runs"`);
    await run("DROP SEQUENCE nodrail.run_events");
  }
}
