import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Declared contracts, reconciled with the engine's frozen grammar (packages/policy-engine/docs/contracts.md):
 *
 * - digests are the engine's `sha256:<hex>`, never bare hex;
 * - the dialect is the grammar's number (1), not `shapes/v1`;
 * - producer classes are spelt as the engine spells them, with hyphens, and
 *   `person-authenticated` joins them on the authoritative path only;
 * - bindings carry the engine's binding names (`receipt:qa`,
 *   `input:stripe.refund`, `request:refund`, `inventory`);
 * - a projection keeps its withheld paths (part of its digest) instead of
 *   its own version, which the dialect already says;
 * - an event keeps the runtime's findings count.
 *
 * Rows written in the earlier form are converted in place: column rewrites
 * are DDL, so row level security doesn't hide any row from them, and a row
 * that can't be converted fails the new checks loudly instead of vanishing.
 */

const prefix = (column: string) =>
  `CASE WHEN "${column}" LIKE 'sha256:%' THEN "${column}" ELSE 'sha256:' || "${column}" END`;
const unprefix = (column: string) =>
  `regexp_replace("${column}", '^sha256:', '')`;
const hyphens = (column: string) => `replace("${column}", '_', '-')`;
const underscores = (column: string) => `replace("${column}", '-', '_')`;

/** Columns holding an engine digest, by table. */
const DIGESTS = {
  contract_revisions: ["digest"],
  contract_projections: ["digest", "contract_digest"],
  contract_bindings: ["contract_digest", "projection_digest"],
  contract_events: ["contract_digest", "projection_digest", "action_digest"],
} as const;

/** Checks this migration replaces, by table: dropped first, added after. */
const REPLACED = {
  contract_revisions: [
    "contract_revisions_digest_format",
    "contract_revisions_dialect",
  ],
  contract_projections: [
    "contract_projections_digests",
    "contract_projections_dialect",
    "contract_projections_version",
  ],
  contract_bindings: [
    "contract_bindings_digests",
    "contract_bindings_target_format",
  ],
  contract_events: [
    "contract_events_contract",
    "contract_events_source",
    "contract_events_producer_class",
    "contract_events_where",
    "contract_events_subject",
  ],
} as const;

const sha = (column: string) => `"${column}" ~ '^sha256:[0-9a-f]{64}$'`;
const hex = (column: string) => `"${column}" ~ '^[0-9a-f]{64}$'`;
const local = `("machine" IS NULL OR "machine" ~ '^[0-9a-f]{32}$') AND ("project" IS NULL OR length("project") BETWEEN 1 AND 200) AND ("host" IS NULL OR "host" ~ '^[a-z][a-z0-9-]{0,39}$') AND ("run" IS NULL OR "run" ~ '^[0-9a-f]{32}$') AND length("agent") <= 200 AND length("step") <= 200`;
/** `contract_events_source` belongs to `contract_events`. */
const tableOf = (check: string) => check.split("_").slice(0, 2).join("_");

const source = (classes: string, verified: string) =>
  `("authority" = 'reported' AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN (${classes}) AND "subject_source" IS DISTINCT FROM '${verified}') OR ("authority" = 'authoritative' AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND "user_id" IS NULL AND "trace_id" IS NULL AND "span_id" IS NULL AND "machine" IS NULL AND "project_id" IS NULL AND "project" IS NULL AND "host" IS NULL AND "run" IS NULL AND "validated_by" IS DISTINCT FROM 'producer')`;

/** The checks as they stand after `up`. */
const AFTER: Record<string, string> = {
  contract_revisions_digest_format: sha("digest"),
  contract_revisions_dialect: `"dialect" BETWEEN 1 AND 999`,
  contract_projections_digests: `${sha("digest")} AND ${sha("contract_digest")}`,
  contract_projections_dialect: `"dialect" BETWEEN 1 AND 999`,
  contract_projections_withheld: `jsonb_typeof("withheld") = 'array' AND jsonb_array_length("withheld") <= 64 AND length("withheld"::text) <= 4096`,
  contract_bindings_digests: `${hex("workspace_revision")} AND ${sha("contract_digest")} AND ("projection_digest" IS NULL OR ${sha("projection_digest")})`,
  contract_bindings_target_format: `length("target") <= 140 AND "target" ~ '^(inventory|[a-z]+:[a-z0-9_.-]{1,130})$'`,
  contract_events_contract: `${sha("contract_digest")} AND ("projection_digest" IS NULL OR ${sha("projection_digest")}) AND "contract_name" ~ '^[a-z][a-z0-9-]{0,62}$'`,
  contract_events_source: source(
    `'agent-reported', 'runtime-observed'`,
    "externally-verified",
  ),
  contract_events_producer_class: `"producer_class" IN ('agent-reported', 'runtime-observed', 'externally-verified', 'person-authenticated')`,
  contract_events_where: `${local} AND ("action_digest" IS NULL OR ${sha("action_digest")})`,
  contract_events_subject: `("subject_revision" IS NULL) = ("subject_source" IS NULL) AND ("subject_revision" IS NULL OR "subject_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$') AND ("subject_source" IS NULL OR "subject_source" IN ('runtime-observed', 'externally-verified'))`,
  contract_events_findings: `"findings_count" IS NULL OR ("validation" = 'valid' AND "surface" IN ('receipt', 'evidence') AND "findings_count" BETWEEN 0 AND 99999)`,
};

/** The checks as DeclaredContracts9998500000000 wrote them, for `down`. */
const BEFORE: Record<string, string> = {
  contract_revisions_digest_format: hex("digest"),
  contract_revisions_dialect: `"dialect" ~ '^shapes/v[1-9][0-9]{0,2}$'`,
  contract_projections_digests: `${hex("digest")} AND ${hex("contract_digest")}`,
  contract_projections_dialect: `"dialect" ~ '^shapes/v[1-9][0-9]{0,2}$'`,
  contract_projections_version: `"version" BETWEEN 1 AND 999`,
  contract_bindings_digests: `${hex("workspace_revision")} AND ${hex("contract_digest")} AND ("projection_digest" IS NULL OR ${hex("projection_digest")})`,
  contract_bindings_target_format: `length("target") <= 200 AND "target" ~ '^[a-z_]+:[A-Za-z0-9._/:@-]+$'`,
  contract_events_contract: `${hex("contract_digest")} AND ("projection_digest" IS NULL OR ${hex("projection_digest")}) AND "contract_name" ~ '^[a-z][a-z0-9-]{0,62}$'`,
  contract_events_source: source(
    `'agent_reported', 'runtime_observed'`,
    "externally_verified",
  ),
  contract_events_producer_class: `"producer_class" IN ('agent_reported', 'runtime_observed', 'externally_verified')`,
  contract_events_where: `${local} AND ("action_digest" IS NULL OR ${hex("action_digest")})`,
  contract_events_subject: `("subject_revision" IS NULL) = ("subject_source" IS NULL) AND ("subject_revision" IS NULL OR "subject_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$') AND ("subject_source" IS NULL OR "subject_source" IN ('runtime_observed', 'externally_verified'))`,
};

/** Earlier attachment locations, as the binding names the engine gives them. */
const TARGET_UP = `CASE
  WHEN "surface" = 'receipt' THEN regexp_replace("target", '^agent:', 'receipt:')
  WHEN "surface" = 'brief' THEN regexp_replace("target", '^agent:', 'brief:')
  WHEN "surface" = 'tool_input' THEN regexp_replace("target", '^connection:', 'input:')
  WHEN "surface" = 'tool_result' THEN regexp_replace("target", '^connection:', 'output:')
  ELSE "target" END`;
const TARGET_DOWN = `CASE
  WHEN "surface" IN ('receipt', 'brief') THEN regexp_replace("target", '^(receipt|brief):', 'agent:')
  WHEN "surface" IN ('tool_input', 'tool_result') THEN regexp_replace("target", '^(input|output):', 'connection:')
  WHEN "target" = 'inventory' THEN 'inventory:labels'
  ELSE "target" END`;

export class ContractGrammar9998600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    for (const [table, checks] of Object.entries(REPLACED))
      for (const check of checks)
        await run(
          `ALTER TABLE "nodrail"."${table}" DROP CONSTRAINT "${check}"`,
        );
    for (const [table, columns] of Object.entries(DIGESTS))
      for (const column of columns)
        await run(
          `ALTER TABLE "nodrail"."${table}" ALTER COLUMN "${column}" TYPE text USING ${prefix(column)}`,
        );
    for (const table of ["contract_revisions", "contract_projections"])
      await run(
        `ALTER TABLE "nodrail"."${table}" ALTER COLUMN "dialect" TYPE integer USING regexp_replace("dialect", '^shapes/v', '')::integer`,
      );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" DROP COLUMN "version"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" ADD "withheld" jsonb NOT NULL DEFAULT '[]'`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_bindings" ALTER COLUMN "target" TYPE text USING ${TARGET_UP}`,
    );
    for (const column of ["producer_class", "subject_source"])
      await run(
        `ALTER TABLE "nodrail"."contract_events" ALTER COLUMN "${column}" TYPE text USING ${hyphens(column)}`,
      );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD "findings_count" integer`,
    );
    for (const [name, check] of Object.entries(AFTER))
      await run(
        `ALTER TABLE "nodrail"."${tableOf(name)}" ADD CONSTRAINT "${name}" CHECK (${check})`,
      );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    for (const name of Object.keys(AFTER))
      await run(
        `ALTER TABLE "nodrail"."${tableOf(name)}" DROP CONSTRAINT "${name}"`,
      );
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP COLUMN "findings_count"`,
    );
    // A person-authenticated event has no earlier spelling: it fails the old check.
    for (const column of ["producer_class", "subject_source"])
      await run(
        `ALTER TABLE "nodrail"."contract_events" ALTER COLUMN "${column}" TYPE text USING ${underscores(column)}`,
      );
    await run(
      `ALTER TABLE "nodrail"."contract_bindings" ALTER COLUMN "target" TYPE text USING ${TARGET_DOWN}`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" DROP COLUMN "withheld"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" ADD "version" integer NOT NULL DEFAULT 1`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_projections" ALTER COLUMN "version" DROP DEFAULT`,
    );
    for (const table of ["contract_revisions", "contract_projections"])
      await run(
        `ALTER TABLE "nodrail"."${table}" ALTER COLUMN "dialect" TYPE text USING 'shapes/v' || "dialect"`,
      );
    for (const [table, columns] of Object.entries(DIGESTS))
      for (const column of columns)
        await run(
          `ALTER TABLE "nodrail"."${table}" ALTER COLUMN "${column}" TYPE text USING ${unprefix(column)}`,
        );
    for (const [name, check] of Object.entries(BEFORE))
      await run(
        `ALTER TABLE "nodrail"."${tableOf(name)}" ADD CONSTRAINT "${name}" CHECK (${check})`,
      );
  }
}
