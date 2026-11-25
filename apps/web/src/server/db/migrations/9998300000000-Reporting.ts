import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Reporting contract v2: what installations report their local
 * hooks did, kept as evidence in `reported_events` (always `source =
 * 'local'`, never read by anything that authorizes, approves or passes a
 * gate); each event once, by its span ids. Inventory reports and intended
 * revisions are keyed by the project's stable id: earlier reports stay
 * visible as `unbound:<name>` and are never merged by name, and intended
 * revisions published by name are removed, since they can't be told
 * apart from another project's; publish again with an id.
 */
export class Reporting9998300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."reported_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "user_id" uuid NOT NULL, "source" text NOT NULL DEFAULT 'local', "kind" text NOT NULL, "trace_id" text NOT NULL, "span_id" text NOT NULL, "machine" text, "project_id" uuid, "project" text NOT NULL, "host" text NOT NULL, "agent" text, "decision" text, "run_event" text, "run" text, "step" text, "tool" text, "operation" text, "policy_revision" text, "details" jsonb NOT NULL DEFAULT '{}', "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "reported_events_once" UNIQUE ("workspace_id", "trace_id", "span_id"), CONSTRAINT "reported_events_details" CHECK (length("details"::text) <= 4000), CONSTRAINT "reported_events_run_event" CHECK (("kind" = 'run.event') = ("run_event" IS NOT NULL AND "run" IS NOT NULL) AND ("run_event" IS NULL OR "run_event" IN ('step.started', 'step.finished', 'action'))), CONSTRAINT "reported_events_decision" CHECK (("kind" = 'decision') = ("decision" IS NOT NULL) AND ("decision" IS NULL OR "decision" IN ('allow', 'deny', 'require_approval'))), CONSTRAINT "reported_events_host" CHECK ("host" ~ '^[a-z][a-z0-9-]{0,39}$'), CONSTRAINT "reported_events_project" CHECK (length("project") BETWEEN 1 AND 200), CONSTRAINT "reported_events_machine" CHECK ("machine" IS NULL OR "machine" ~ '^[0-9a-f]{32}$'), CONSTRAINT "reported_events_ids" CHECK ("trace_id" ~ '^[0-9a-f]{32}$' AND "span_id" ~ '^[0-9a-f]{16}$'), CONSTRAINT "reported_events_kind" CHECK ("kind" IN ('decision', 'run.event')), CONSTRAINT "reported_events_source" CHECK ("source" = 'local'), CONSTRAINT "PK_ae1a3ff839498caf484a714f504" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "reported_events_by_run" ON "nodrail"."reported_events"  ("workspace_id", "environment_id", "run") `,
    );
    await run(
      `CREATE INDEX "reported_events_by_time" ON "nodrail"."reported_events"  ("workspace_id", "environment_id", "occurred_at") `,
    );
    await run(
      `ALTER TABLE "nodrail"."reported_events" ADD CONSTRAINT "FK_4a93139651de0c5efae822f7e60" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."reported_events" ADD CONSTRAINT "FK_2b7b9c33ca56dc9340619a1842c" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run("ALTER TABLE nodrail.reported_events ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.reported_events FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY tenant ON nodrail.reported_events
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    // Reports are added and, with their person or by retention, removed.
    await run(
      "GRANT SELECT, INSERT, DELETE ON nodrail.reported_events TO nodrail_app",
    );
    await run("GRANT SELECT ON nodrail.reported_events TO nodrail_member_read");
    // Retention removes reports a year old, across workspaces.
    await run(`
      CREATE POLICY maintenance ON nodrail.reported_events
        FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
    `);
    await run(
      "GRANT SELECT (id, received_at), DELETE ON nodrail.reported_events TO nodrail_maintenance",
    );

    // Inventory: by the project's id, or visibly unbound by its name.
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD "project_id" uuid`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD "project_key" text`,
    );
    // Row security binds the owner too (FORCE): lifted for the backfill
    // only, or it would see no rows and change none.
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" NO FORCE ROW LEVEL SECURITY`,
    );
    await run(
      `UPDATE "nodrail"."inventory_reports" SET "project_key" = 'unbound:' || "project"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" FORCE ROW LEVEL SECURITY`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ALTER COLUMN "project_key" SET NOT NULL`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD CONSTRAINT "inventory_reports_project_key" CHECK ("project_key" = coalesce("project_id"::text, 'unbound:' || "project"))`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" DROP CONSTRAINT "inventory_reports_latest"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD CONSTRAINT "inventory_reports_latest" UNIQUE ("workspace_id", "environment_id", "user_id", "machine", "project_key", "host")`,
    );

    // Intended revisions: by the project's id only.
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" NO FORCE ROW LEVEL SECURITY`,
    );
    await run(`DELETE FROM "nodrail"."intended_revisions"`);
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" FORCE ROW LEVEL SECURITY`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" DROP CONSTRAINT "intended_revisions_project"`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" ADD "project_id" uuid NOT NULL`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" ADD CONSTRAINT "intended_revisions_project" UNIQUE ("workspace_id", "environment_id", "project_id")`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" DROP CONSTRAINT "intended_revisions_project"`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" DROP COLUMN "project_id"`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" ADD CONSTRAINT "intended_revisions_project" UNIQUE ("workspace_id", "environment_id", "project")`,
    );
    // Two ids under one name can't share the old key: keep the latest.
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" NO FORCE ROW LEVEL SECURITY`,
    );
    await run(`
      DELETE FROM "nodrail"."inventory_reports" r USING "nodrail"."inventory_reports" newer
      WHERE r.workspace_id = newer.workspace_id AND r.environment_id = newer.environment_id
        AND r.user_id = newer.user_id AND r.machine = newer.machine
        AND r.project = newer.project AND r.host = newer.host
        AND r.observed_at < newer.observed_at
    `);
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" FORCE ROW LEVEL SECURITY`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" DROP CONSTRAINT "inventory_reports_latest"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" DROP CONSTRAINT "inventory_reports_project_key"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" DROP COLUMN "project_key"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" DROP COLUMN "project_id"`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD CONSTRAINT "inventory_reports_latest" UNIQUE ("workspace_id", "environment_id", "user_id", "machine", "project", "host")`,
    );
    // Its policy, grants, indexes and keys go with the table.
    await run(`DROP TABLE "nodrail"."reported_events"`);
  }
}
