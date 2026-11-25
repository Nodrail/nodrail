import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Evidence from verifiers: GitHub Actions
 * workflows trusted to produce `externally-verified` evidence, the single
 * use of each OIDC token, what a published workspace revision declares
 * about evidence (its bindings' verifiers and its gates' requirements), and
 * on `contract_events` a third source: a verifier's event, authoritative and
 * server-validated, naming no installation.
 *
 * - `authorized_value` keeps the valid value without classified paths, for
 *   the gate evaluator only. The read role loses table-wide SELECT on
 *   `contract_events` and gets every column except it and `body_digest`.
 * - `seq` numbers events as they arrive: the last received decides.
 *
 * Existing rows satisfy every new check (they name no verifier), so nothing
 * is rewritten beyond numbering them. Going down drops verifier events with
 * their verifiers: once the columns go, nothing could tell them apart from an
 * installation's.
 */

const TABLES = [
  "evidence_verifiers",
  "evidence_token_uses",
  "evidence_bindings",
  "evidence_requirements",
] as const;

const NO_REPORTER = `"user_id" IS NULL AND "trace_id" IS NULL AND "span_id" IS NULL AND "machine" IS NULL AND "project_id" IS NULL AND "project" IS NULL AND "host" IS NULL AND "run" IS NULL`;
const REPORTED = `"authority" = 'reported' AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN ('agent-reported', 'runtime-observed') AND "subject_source" IS DISTINCT FROM 'externally-verified'`;
const INSTALLATION = `"authority" = 'authoritative' AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "validated_by" IS DISTINCT FROM 'producer'`;
const VERIFIER = `"authority" = 'authoritative' AND "verifier_id" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "surface" = 'evidence' AND "evidence" IS NOT NULL AND "producer_class" = 'externally-verified' AND "subject_source" = 'externally-verified' AND "validated_by" = 'server' AND "provenance" IS NOT NULL AND "body_digest" IS NOT NULL`;

const SOURCE = {
  up: `(${REPORTED.replace(`"authority" = 'reported'`, `"authority" = 'reported' AND "verifier_id" IS NULL`)}) OR (${INSTALLATION.replace(`"authority" = 'authoritative'`, `"authority" = 'authoritative' AND "verifier_id" IS NULL`)}) OR (${VERIFIER})`,
  down: `(${REPORTED}) OR (${INSTALLATION})`,
};

/** Columns the read role may not select: values only the evaluator reads. */
const EVALUATOR_ONLY = ["authorized_value", "body_digest"];

export class EvidenceVerifiers9999100000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."evidence_verifiers" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "name" text NOT NULL, "kind" text NOT NULL DEFAULT 'github-actions', "environment_ids" uuid array NOT NULL, "repository_id" text NOT NULL, "repository" text NOT NULL, "job_workflow_ref" text NOT NULL, "allowed_refs" text array NOT NULL DEFAULT '{}', "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by" uuid, CONSTRAINT "UQ_e54bf00e68ad811eceb46723e7f" UNIQUE ("workspace_id", "id"), CONSTRAINT "evidence_verifiers_revoked" CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL)), CONSTRAINT "evidence_verifiers_lists" CHECK (cardinality("environment_ids") BETWEEN 1 AND 20 AND cardinality("allowed_refs") <= 20), CONSTRAINT "evidence_verifiers_workflow" CHECK (length("job_workflow_ref") BETWEEN 3 AND 500 AND "job_workflow_ref" LIKE '%@%'), CONSTRAINT "evidence_verifiers_repository" CHECK ("repository_id" ~ '^[1-9][0-9]{0,19}$' AND length("repository") BETWEEN 3 AND 200), CONSTRAINT "evidence_verifiers_kind" CHECK ("kind" = 'github-actions'), CONSTRAINT "evidence_verifiers_name" CHECK ("name" ~ '^[a-z][a-z0-9-]{0,62}$'), CONSTRAINT "PK_8cd898dd2a1dd11b024d1582011" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE UNIQUE INDEX "evidence_verifiers_active_name" ON "nodrail"."evidence_verifiers"  ("workspace_id", "name") WHERE "revoked_at" IS NULL`,
    );
    await run(
      `CREATE TABLE "nodrail"."evidence_token_uses" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "verifier_id" uuid NOT NULL, "jti" text NOT NULL, "body_digest" text NOT NULL, "event_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "evidence_token_uses_once" UNIQUE ("workspace_id", "verifier_id", "jti"), CONSTRAINT "evidence_token_uses_values" CHECK (length("jti") BETWEEN 1 AND 200 AND "body_digest" ~ '^sha256:[0-9a-f]{64}$'), CONSTRAINT "PK_de99298c5a3c571ab5f9dceb3e6" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "evidence_token_uses_by_expiry" ON "nodrail"."evidence_token_uses"  ("expires_at") `,
    );
    await run(
      `CREATE TABLE "nodrail"."evidence_bindings" ("published_by" uuid NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "project_id" uuid NOT NULL, "workspace_revision" text NOT NULL, "evidence" text NOT NULL, "contract_digest" text NOT NULL, "verifiers" text array NOT NULL, "subject" text NOT NULL, CONSTRAINT "evidence_bindings_target" UNIQUE ("workspace_id", "environment_id", "project_id", "workspace_revision", "evidence"), CONSTRAINT "evidence_bindings_values" CHECK ("workspace_revision" ~ '^[0-9a-f]{64}$' AND "evidence" ~ '^[a-z][a-z0-9-]{0,62}$' AND "contract_digest" ~ '^sha256:[0-9a-f]{64}$' AND cardinality("verifiers") <= 10 AND "subject" IN ('revision', 'none')), CONSTRAINT "PK_d71f016685674a52ece634b6b00" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE TABLE "nodrail"."evidence_requirements" ("published_by" uuid NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "project_id" uuid NOT NULL, "workspace_revision" text NOT NULL, "evidence" text NOT NULL, "gate" text NOT NULL, "requirement_index" integer NOT NULL, "authority" text NOT NULL, "where" jsonb NOT NULL DEFAULT '[]', CONSTRAINT "evidence_requirements_target" UNIQUE ("workspace_id", "environment_id", "project_id", "workspace_revision", "gate", "requirement_index"), CONSTRAINT "evidence_requirements_values" CHECK ("workspace_revision" ~ '^[0-9a-f]{64}$' AND "evidence" ~ '^[a-z][a-z0-9-]{0,62}$' AND length("gate") BETWEEN 1 AND 200 AND "requirement_index" BETWEEN 0 AND 19 AND "authority" IN ('agent-reported', 'runtime-observed', 'externally-verified') AND jsonb_typeof("where") = 'array' AND jsonb_array_length("where") <= 20 AND length("where"::text) <= 8192), CONSTRAINT "PK_a6784ff54c8127fdda34205ea5c" PRIMARY KEY ("id"))`,
    );
    await run(`ALTER TABLE "nodrail"."contract_events" ADD "verifier_id" uuid`);
    await run(`ALTER TABLE "nodrail"."contract_events" ADD "evidence" text`);
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD "authorized_value" jsonb`,
    );
    await run(`ALTER TABLE "nodrail"."contract_events" ADD "provenance" jsonb`);
    await run(`ALTER TABLE "nodrail"."contract_events" ADD "body_digest" text`);
    // Existing rows are numbered in no particular order; none is evidence.
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD "seq" BIGSERIAL NOT NULL`,
    );
    await run(
      `CREATE INDEX "contract_events_by_evidence" ON "nodrail"."contract_events"  ("workspace_id", "environment_id", "evidence", "subject_revision", "seq") `,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_verified" CHECK (("verifier_id" IS NOT NULL OR ("evidence" IS NULL AND "authorized_value" IS NULL AND "provenance" IS NULL AND "body_digest" IS NULL)) AND ("evidence" IS NULL OR ("surface" = 'evidence' AND "evidence" ~ '^[a-z][a-z0-9-]{0,62}$')) AND ("authorized_value" IS NULL OR (jsonb_typeof("authorized_value") = 'object' AND length("authorized_value"::text) <= 16384 AND "validation" = 'valid')) AND ("provenance" IS NULL OR (jsonb_typeof("provenance") = 'object' AND length("provenance"::text) <= 2048)) AND ("body_digest" IS NULL OR "body_digest" ~ '^sha256:[0-9a-f]{64}$'))`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_source"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_source" CHECK (${SOURCE.up})`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_verified_once" UNIQUE ("workspace_id", "verifier_id", "idempotency_key")`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_verifiers" ADD CONSTRAINT "FK_9cc90bbd7ffb1f74c5fb60b08a3" FOREIGN KEY ("workspace_id", "created_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_verifiers" ADD CONSTRAINT "FK_81c5b50d8789c39e5a67bb5e2d1" FOREIGN KEY ("workspace_id", "revoked_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_token_uses" ADD CONSTRAINT "FK_b8c14b88d1122bb828d0ab1a9b6" FOREIGN KEY ("verifier_id", "workspace_id") REFERENCES "nodrail"."evidence_verifiers"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_bindings" ADD CONSTRAINT "FK_3d6efeb83093a79a21234685214" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_bindings" ADD CONSTRAINT "FK_65c019b523ea460d07e141542bd" FOREIGN KEY ("workspace_id", "published_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_requirements" ADD CONSTRAINT "FK_20b46967f85f2e954d7006f4bd5" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."evidence_requirements" ADD CONSTRAINT "FK_994448e89774ddd23f26735a717" FOREIGN KEY ("workspace_id", "published_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "FK_10f742aec2150632ae77a2a3b13" FOREIGN KEY ("verifier_id", "workspace_id") REFERENCES "nodrail"."evidence_verifiers"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    for (const table of TABLES) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
      await run(`
        CREATE POLICY maintenance ON nodrail.${table}
          FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
      `);
    }
    // A verifier is never edited, only revoked; it stays while events name it.
    await run(
      "GRANT SELECT, INSERT, UPDATE (revoked_at, revoked_by) ON nodrail.evidence_verifiers TO nodrail_app",
    );
    await run(
      "GRANT SELECT, INSERT ON nodrail.evidence_token_uses, nodrail.evidence_bindings, nodrail.evidence_requirements TO nodrail_app",
    );
    await run(
      "GRANT SELECT ON nodrail.evidence_verifiers, nodrail.evidence_bindings, nodrail.evidence_requirements TO nodrail_member_read",
    );
    // Retention: token uses a day after they expire, pins like bindings.
    await run(
      "GRANT SELECT (id, expires_at), DELETE ON nodrail.evidence_token_uses TO nodrail_maintenance",
    );
    for (const table of ["evidence_bindings", "evidence_requirements"])
      await run(
        `GRANT SELECT (id, workspace_id, environment_id, project_id, workspace_revision, published_at), DELETE ON nodrail.${table} TO nodrail_maintenance`,
      );
    await run(
      "GRANT USAGE ON SEQUENCE nodrail.contract_events_seq_seq TO nodrail_app",
    );
    // The read role sees every column of an event but the evaluator's own.
    await run(
      "REVOKE SELECT ON nodrail.contract_events FROM nodrail_member_read",
    );
    const columns: { column_name: string }[] = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'nodrail' AND table_name = 'contract_events'
         AND column_name <> ALL($1)
       ORDER BY ordinal_position`,
      [EVALUATOR_ONLY],
    );
    await run(
      `GRANT SELECT (${columns.map((c) => `"${c.column_name}"`).join(", ")}) ON nodrail.contract_events TO nodrail_member_read`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    // Forced row security would hide every workspace's rows from the owner:
    // lifted for this one statement, inside the migration's transaction.
    await run(
      "ALTER TABLE nodrail.contract_events NO FORCE ROW LEVEL SECURITY",
    );
    await run(
      `DELETE FROM "nodrail"."contract_events" WHERE "verifier_id" IS NOT NULL`,
    );
    await run("ALTER TABLE nodrail.contract_events FORCE ROW LEVEL SECURITY");
    const columns: { column_name: string }[] = await queryRunner.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'nodrail' AND table_name = 'contract_events'`,
    );
    await run(
      `REVOKE SELECT (${columns.map((c) => `"${c.column_name}"`).join(", ")}) ON nodrail.contract_events FROM nodrail_member_read`,
    );
    await run("GRANT SELECT ON nodrail.contract_events TO nodrail_member_read");
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "FK_10f742aec2150632ae77a2a3b13"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_verified_once"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_source"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_verified"`,
    );
    await run(`DROP INDEX "nodrail"."contract_events_by_evidence"`);
    for (const column of [
      "seq",
      "body_digest",
      "provenance",
      "authorized_value",
      "evidence",
      "verifier_id",
    ])
      await run(
        `ALTER TABLE "nodrail"."contract_events" DROP COLUMN "${column}"`,
      );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_source" CHECK (${SOURCE.down})`,
    );
    // Policies, grants, indexes and keys go with each table.
    for (const table of [...TABLES].reverse())
      await run(`DROP TABLE nodrail.${table}`);
  }
}
