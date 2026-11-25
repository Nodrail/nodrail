import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The team's inventory (W4): what each person's machines last reported
 * about a project on a host, as `nodrail observe` sends it. A tenant
 * table: each report is the reporting person's own, and leaving the
 * workspace removes theirs. `intended_revisions` holds the locked
 * revision each project should run in an environment. Personal tokens
 * gain `inventory:write`, a token of its own that reads nothing, since it
 * sits where agents run.
 */
export class Inventory9998200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."inventory_reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "user_id" uuid NOT NULL, "machine" text NOT NULL, "project" text NOT NULL, "host" text NOT NULL, "agent" text, "activation" text NOT NULL, "in_step" boolean NOT NULL, "drift" integer NOT NULL, "applied_revision" text, "locked_revision" text, "unmanaged" jsonb NOT NULL, "names" jsonb, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "inventory_reports_latest" UNIQUE ("workspace_id", "environment_id", "user_id", "machine", "project", "host"), CONSTRAINT "inventory_reports_sizes" CHECK (length("unmanaged"::text) <= 2000 AND ("names" IS NULL OR length("names"::text) <= 10000)), CONSTRAINT "inventory_reports_drift" CHECK ("drift" BETWEEN 0 AND 100000), CONSTRAINT "inventory_reports_revisions" CHECK (("applied_revision" IS NULL OR "applied_revision" ~ '^[0-9a-f]{64}$') AND ("locked_revision" IS NULL OR "locked_revision" ~ '^[0-9a-f]{64}$')), CONSTRAINT "inventory_reports_activation" CHECK ("activation" IN ('verified', 'configured', 'inactive', 'unknown')), CONSTRAINT "inventory_reports_agent" CHECK (length("agent") <= 200), CONSTRAINT "inventory_reports_host" CHECK ("host" ~ '^[a-z][a-z0-9-]{0,39}$'), CONSTRAINT "inventory_reports_project" CHECK (length("project") BETWEEN 1 AND 200), CONSTRAINT "inventory_reports_machine" CHECK ("machine" ~ '^[0-9a-f]{32}$'), CONSTRAINT "PK_9495548e34efe7ba0b9233d5508" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "inventory_reports_by_environment" ON "nodrail"."inventory_reports"  ("workspace_id", "environment_id", "observed_at") `,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD CONSTRAINT "FK_1266cae9a03af00a04ae7da33a3" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."inventory_reports" ADD CONSTRAINT "FK_fc6f2da7f0f6ae6625f323bde1a" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      "ALTER TABLE nodrail.inventory_reports ENABLE ROW LEVEL SECURITY",
    );
    await run("ALTER TABLE nodrail.inventory_reports FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY tenant ON nodrail.inventory_reports
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON nodrail.inventory_reports TO nodrail_app",
    );
    await run(
      "GRANT SELECT ON nodrail.inventory_reports TO nodrail_member_read",
    );

    // Which locked revision each project should run here: digests only.
    await run(
      `CREATE TABLE "nodrail"."intended_revisions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "project" text NOT NULL, "revision" text NOT NULL, "policy_revision" text, "files" jsonb NOT NULL, "published_by" uuid NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "intended_revisions_project" UNIQUE ("workspace_id", "environment_id", "project"), CONSTRAINT "intended_revisions_files" CHECK (length("files"::text) <= 300000), CONSTRAINT "intended_revisions_policy" CHECK ("policy_revision" IS NULL OR "policy_revision" ~ '^[0-9a-f]{64}$'), CONSTRAINT "intended_revisions_revision" CHECK ("revision" ~ '^[0-9a-f]{64}$'), CONSTRAINT "intended_revisions_project_name" CHECK (length("project") BETWEEN 1 AND 200), CONSTRAINT "PK_c5b6dc5d258dff5801d6eb0d6f8" PRIMARY KEY ("id"))`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" ADD CONSTRAINT "FK_3b18922a465e1d8f8198d735dc8" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."intended_revisions" ADD CONSTRAINT "FK_7892fa826148323188ee5e30f6a" FOREIGN KEY ("workspace_id", "published_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      "ALTER TABLE nodrail.intended_revisions ENABLE ROW LEVEL SECURITY",
    );
    await run(
      "ALTER TABLE nodrail.intended_revisions FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE POLICY tenant ON nodrail.intended_revisions
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(
      "GRANT SELECT, INSERT, UPDATE ON nodrail.intended_revisions TO nodrail_app",
    );
    await run(
      "GRANT SELECT ON nodrail.intended_revisions TO nodrail_member_read",
    );

    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" DROP CONSTRAINT "personal_access_tokens_scopes"`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_scopes" CHECK ("scopes" <@ ARRAY['read', 'decide', 'rules:write', 'inventory:write']::text[] AND ('read' = ANY ("scopes") OR "scopes" = ARRAY['inventory:write']::text[]))`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    // Reporting tokens can't be kept under the old rule.
    await run(
      `DELETE FROM "nodrail"."personal_access_tokens" WHERE 'inventory:write' = ANY ("scopes")`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" DROP CONSTRAINT "personal_access_tokens_scopes"`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_scopes" CHECK ("scopes" <@ ARRAY['read', 'decide', 'rules:write']::text[] AND 'read' = ANY ("scopes"))`,
    );
    // Their policies, grants, indexes and keys go with the tables.
    await run(`DROP TABLE "nodrail"."intended_revisions"`);
    await run(`DROP TABLE "nodrail"."inventory_reports"`);
  }
}
