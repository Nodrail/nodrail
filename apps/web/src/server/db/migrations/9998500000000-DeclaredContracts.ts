import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Declared contracts: immutable full contract
 * revisions (publish path only), their reporting projections, the bindings
 * one published workspace revision declares, and the validated events that
 * name them. A `reported` event is local evidence and the checks keep it
 * from ever looking authoritative; nothing that authorizes reads one.
 * Revisions are only added: the application may insert and read them, and
 * retention removes one only once no event or binding names it.
 */
const TABLES = [
  "contract_revisions",
  "contract_projections",
  "contract_bindings",
  "contract_events",
] as const;

export class DeclaredContracts9998500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."contract_revisions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "surface" text NOT NULL, "digest" text NOT NULL, "name" text NOT NULL, "dialect" text NOT NULL, "property_count" integer NOT NULL, "schema" jsonb NOT NULL, "registered_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "contract_revisions_digest" UNIQUE ("workspace_id", "surface", "digest"), CONSTRAINT "contract_revisions_schema" CHECK (jsonb_typeof("schema") = 'object' AND length("schema"::text) <= 65536), CONSTRAINT "contract_revisions_properties" CHECK ("property_count" BETWEEN 1 AND 64), CONSTRAINT "contract_revisions_dialect" CHECK ("dialect" ~ '^shapes/v[1-9][0-9]{0,2}$'), CONSTRAINT "contract_revisions_name" CHECK ("name" ~ '^[a-z][a-z0-9-]{0,62}$'), CONSTRAINT "contract_revisions_surface" CHECK ("surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'approval_form', 'inventory_metadata')), CONSTRAINT "contract_revisions_digest_format" CHECK ("digest" ~ '^[0-9a-f]{64}$'), CONSTRAINT "PK_4fe2d66e4bf51f2622446051ef1" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE TABLE "nodrail"."contract_projections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "surface" text NOT NULL, "digest" text NOT NULL, "contract_digest" text NOT NULL, "name" text NOT NULL, "dialect" text NOT NULL, "version" integer NOT NULL, "schema" jsonb NOT NULL, "fields" jsonb NOT NULL, "registered_via" text NOT NULL, "registered_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "contract_projections_digest" UNIQUE ("workspace_id", "surface", "digest"), CONSTRAINT "contract_projections_registered_via" CHECK ("registered_via" IN ('publish', 'report')), CONSTRAINT "contract_projections_fields" CHECK (jsonb_typeof("fields") = 'array' AND jsonb_array_length("fields") <= 64 AND length("fields"::text) <= 16384), CONSTRAINT "contract_projections_schema" CHECK (jsonb_typeof("schema") = 'object' AND length("schema"::text) <= 32768), CONSTRAINT "contract_projections_version" CHECK ("version" BETWEEN 1 AND 999), CONSTRAINT "contract_projections_dialect" CHECK ("dialect" ~ '^shapes/v[1-9][0-9]{0,2}$'), CONSTRAINT "contract_projections_name" CHECK ("name" ~ '^[a-z][a-z0-9-]{0,62}$'), CONSTRAINT "contract_projections_surface" CHECK ("surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'approval_form', 'inventory_metadata')), CONSTRAINT "contract_projections_digests" CHECK ("digest" ~ '^[0-9a-f]{64}$' AND "contract_digest" ~ '^[0-9a-f]{64}$'), CONSTRAINT "PK_d754c5a97f5ba81d58694dea985" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "contract_projections_by_contract" ON "nodrail"."contract_projections"  ("workspace_id", "surface", "contract_digest") `,
    );
    await run(
      `CREATE TABLE "nodrail"."contract_bindings" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "project_id" uuid NOT NULL, "workspace_revision" text NOT NULL, "surface" text NOT NULL, "target" text NOT NULL, "contract_digest" text NOT NULL, "projection_digest" text, "published_by" uuid NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "contract_bindings_target" UNIQUE ("workspace_id", "environment_id", "project_id", "workspace_revision", "surface", "target"), CONSTRAINT "contract_bindings_target_format" CHECK (length("target") <= 200 AND "target" ~ '^[a-z_]+:[A-Za-z0-9._/:@-]+$'), CONSTRAINT "contract_bindings_surface" CHECK ("surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'approval_form', 'inventory_metadata')), CONSTRAINT "contract_bindings_digests" CHECK ("workspace_revision" ~ '^[0-9a-f]{64}$' AND "contract_digest" ~ '^[0-9a-f]{64}$' AND ("projection_digest" IS NULL OR "projection_digest" ~ '^[0-9a-f]{64}$')), CONSTRAINT "PK_d31ab96b5c2b501b67528eebfef" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE TABLE "nodrail"."contract_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "authority" text NOT NULL, "producer_class" text NOT NULL, "surface" text NOT NULL, "contract_name" text NOT NULL, "contract_digest" text NOT NULL, "projection_digest" text, "user_id" uuid, "trace_id" text, "span_id" text, "machine" text, "project_id" uuid, "project" text, "host" text, "run" text, "installation_id" uuid, "idempotency_key" text, "run_id" uuid, "action_digest" text, "approval_request_id" uuid, "agent" text, "step" text, "subject_revision" text, "subject_source" text, "capture" text NOT NULL, "validation" text, "validated_by" text, "projection_validation" text, "verdict" text, "execution" text, "payload" jsonb NOT NULL DEFAULT '{}', "redacted" jsonb NOT NULL DEFAULT '[]', "issues" jsonb NOT NULL DEFAULT '[]', "issue_count" integer NOT NULL DEFAULT '0', "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "contract_events_runtime_once" UNIQUE ("workspace_id", "installation_id", "idempotency_key"), CONSTRAINT "contract_events_reported_once" UNIQUE ("workspace_id", "trace_id", "span_id"), CONSTRAINT "contract_events_issues" CHECK (jsonb_typeof("issues") = 'array' AND jsonb_array_length("issues") <= 20 AND length("issues"::text) <= 4096 AND "issue_count" BETWEEN jsonb_array_length("issues") AND 99999 AND ("validation" IS DISTINCT FROM 'valid' OR "issue_count" = 0) AND ("validation" IS DISTINCT FROM 'invalid' OR "issue_count" > 0)), CONSTRAINT "contract_events_redacted" CHECK (jsonb_typeof("redacted") = 'array' AND jsonb_array_length("redacted") <= 64 AND length("redacted"::text) <= 4096), CONSTRAINT "contract_events_payload" CHECK (jsonb_typeof("payload") = 'object' AND length("payload"::text) <= 8192 AND ("capture" = 'captured' OR "payload" = '{}')), CONSTRAINT "contract_events_execution" CHECK ("execution" IS NULL OR ("surface" = 'tool_result' AND "execution" IN ('succeeded', 'failed', 'unknown'))), CONSTRAINT "contract_events_verdict" CHECK ("verdict" IS NULL OR ("validation" = 'valid' AND "surface" = 'receipt' AND "verdict" ~ '^[a-z0-9][a-z0-9_-]{0,31}$')), CONSTRAINT "contract_events_states" CHECK ("capture" IN ('captured', 'missing', 'unsupported') AND ("capture" = 'captured') = ("validation" IS NOT NULL AND "validated_by" IS NOT NULL AND "projection_digest" IS NOT NULL AND "projection_validation" IS NOT NULL) AND ("validation" IS NULL OR "validation" IN ('valid', 'invalid')) AND ("validated_by" IS NULL OR "validated_by" IN ('producer', 'server')) AND ("projection_validation" IS NULL OR "projection_validation" IN ('valid', 'invalid'))), CONSTRAINT "contract_events_subject" CHECK (("subject_revision" IS NULL) = ("subject_source" IS NULL) AND ("subject_revision" IS NULL OR "subject_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$') AND ("subject_source" IS NULL OR "subject_source" IN ('runtime_observed', 'externally_verified'))), CONSTRAINT "contract_events_where" CHECK (("machine" IS NULL OR "machine" ~ '^[0-9a-f]{32}$') AND ("project" IS NULL OR length("project") BETWEEN 1 AND 200) AND ("host" IS NULL OR "host" ~ '^[a-z][a-z0-9-]{0,39}$') AND ("run" IS NULL OR "run" ~ '^[0-9a-f]{32}$') AND length("agent") <= 200 AND length("step") <= 200 AND ("action_digest" IS NULL OR "action_digest" ~ '^[0-9a-f]{64}$')), CONSTRAINT "contract_events_ids" CHECK (("trace_id" IS NULL OR "trace_id" ~ '^[0-9a-f]{32}$') AND ("span_id" IS NULL OR "span_id" ~ '^[0-9a-f]{16}$') AND ("idempotency_key" IS NULL OR length("idempotency_key") BETWEEN 1 AND 128)), CONSTRAINT "contract_events_producer_class" CHECK ("producer_class" IN ('agent_reported', 'runtime_observed', 'externally_verified')), CONSTRAINT "contract_events_source" CHECK (("authority" = 'reported' AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN ('agent_reported', 'runtime_observed') AND "subject_source" IS DISTINCT FROM 'externally_verified') OR ("authority" = 'authoritative' AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND "user_id" IS NULL AND "trace_id" IS NULL AND "span_id" IS NULL AND "machine" IS NULL AND "project_id" IS NULL AND "project" IS NULL AND "host" IS NULL AND "run" IS NULL AND "validated_by" IS DISTINCT FROM 'producer')), CONSTRAINT "contract_events_contract" CHECK ("contract_digest" ~ '^[0-9a-f]{64}$' AND ("projection_digest" IS NULL OR "projection_digest" ~ '^[0-9a-f]{64}$') AND "contract_name" ~ '^[a-z][a-z0-9-]{0,62}$'), CONSTRAINT "contract_events_surface" CHECK ("surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'approval_form', 'inventory_metadata')), CONSTRAINT "PK_17d7f1e53e9a506a40fef579039" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "contract_events_by_action" ON "nodrail"."contract_events"  ("workspace_id", "action_digest") `,
    );
    await run(
      `CREATE INDEX "contract_events_by_run" ON "nodrail"."contract_events"  ("workspace_id", "environment_id", "run") `,
    );
    await run(
      `CREATE INDEX "contract_events_by_contract" ON "nodrail"."contract_events"  ("workspace_id", "environment_id", "surface", "contract_digest", "occurred_at") `,
    );
    await run(
      `CREATE INDEX "contract_events_by_time" ON "nodrail"."contract_events"  ("workspace_id", "environment_id", "occurred_at") `,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_revisions" ADD CONSTRAINT "FK_d6adcc64b4ca7b0f98e8683096b" FOREIGN KEY ("workspace_id", "registered_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" ADD CONSTRAINT "FK_7b5b3cc99aa452a443498afe463" FOREIGN KEY ("workspace_id", "registered_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_bindings" ADD CONSTRAINT "FK_069c8a167af848d82418c5333ee" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_bindings" ADD CONSTRAINT "FK_d5d20d1d21ec625b8dcca8538eb" FOREIGN KEY ("workspace_id", "published_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "FK_bf5e470251b7c99e489c2bd926a" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "FK_8ce55e56d89d0e5c0a8ce50594e" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "FK_70b4d4559a80038e2b22825e716" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "FK_3444a1311bcd7a8c1d3d6731776" FOREIGN KEY ("approval_request_id", "workspace_id") REFERENCES "nodrail"."approval_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    for (const table of TABLES) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
      // Retention, across workspaces, once nothing needs a row.
      await run(`
        CREATE POLICY maintenance ON nodrail.${table}
          FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
      `);
      await run(`GRANT SELECT ON nodrail.${table} TO nodrail_member_read`);
    }
    // Immutable: a digest names one content forever.
    await run(
      "GRANT SELECT, INSERT ON nodrail.contract_revisions, nodrail.contract_projections, nodrail.contract_bindings TO nodrail_app",
    );
    // Events are added and, with their person or by retention, removed.
    await run(
      "GRANT SELECT, INSERT, DELETE ON nodrail.contract_events TO nodrail_app",
    );
    // Retention reads only keys and times.
    await run(
      "GRANT SELECT (id, workspace_id, surface, digest, created_at), DELETE ON nodrail.contract_revisions TO nodrail_maintenance",
    );
    await run(
      "GRANT SELECT (id, workspace_id, surface, digest, contract_digest, created_at), DELETE ON nodrail.contract_projections TO nodrail_maintenance",
    );
    await run(
      "GRANT SELECT (id, workspace_id, environment_id, project_id, workspace_revision, surface, contract_digest, projection_digest, published_at), DELETE ON nodrail.contract_bindings TO nodrail_maintenance",
    );
    await run(
      "GRANT SELECT (id, workspace_id, surface, contract_digest, projection_digest, received_at), DELETE ON nodrail.contract_events TO nodrail_maintenance",
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query("SET LOCAL lock_timeout = '5s'");
    // Policies, grants, indexes and keys go with each table.
    for (const table of [...TABLES].reverse())
      await queryRunner.query(`DROP TABLE nodrail.${table}`);
  }
}
