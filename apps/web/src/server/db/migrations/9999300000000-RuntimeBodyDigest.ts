import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A brief, input or result an installation submits keeps its body's
 * fingerprint in `body_digest`, as a verifier's evidence already does, so a
 * retry under the same idempotency key is told apart from another payload
 * (409 IDEMPOTENCY_CONFLICT). Only the check changes: the column, its format
 * check and its read grant (the read role can't select it) are
 * EvidenceVerifiers'. Reported rows still never carry one.
 *
 * Going down clears the installations' fingerprints first: the old check
 * allows none.
 */

const OTHERS = `("evidence" IS NULL OR ("surface" = 'evidence' AND "evidence" ~ '^[a-z][a-z0-9-]{0,62}$')) AND ("authorized_value" IS NULL OR (jsonb_typeof("authorized_value") = 'object' AND length("authorized_value"::text) <= 16384 AND "validation" = 'valid')) AND ("provenance" IS NULL OR (jsonb_typeof("provenance") = 'object' AND length("provenance"::text) <= 2048)) AND ("body_digest" IS NULL OR "body_digest" ~ '^sha256:[0-9a-f]{64}$')`;

const VERIFIED = {
  up: `("verifier_id" IS NOT NULL OR ("evidence" IS NULL AND "authorized_value" IS NULL AND "provenance" IS NULL AND ("body_digest" IS NULL OR "installation_id" IS NOT NULL))) AND ${OTHERS}`,
  down: `("verifier_id" IS NOT NULL OR ("evidence" IS NULL AND "authorized_value" IS NULL AND "provenance" IS NULL AND "body_digest" IS NULL)) AND ${OTHERS}`,
};

export class RuntimeBodyDigest9999300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_verified"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_verified" CHECK (${VERIFIED.up})`,
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
      `UPDATE "nodrail"."contract_events" SET "body_digest" = NULL WHERE "verifier_id" IS NULL`,
    );
    await run("ALTER TABLE nodrail.contract_events FORCE ROW LEVEL SECURITY");
    await run(
      `ALTER TABLE "nodrail"."contract_events" DROP CONSTRAINT "contract_events_verified"`,
    );
    await run(
      `ALTER TABLE "nodrail"."contract_events" ADD CONSTRAINT "contract_events_verified" CHECK (${VERIFIED.down})`,
    );
  }
}
