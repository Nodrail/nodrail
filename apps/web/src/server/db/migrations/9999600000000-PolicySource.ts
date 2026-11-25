import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A policy version published from a file keeps the file and its SHA-256
 * (the same digest a lock records for its effective policy), so a host's
 * data plane can fetch exactly what is live and tell whether its own copy
 * matches. Versions made on screen keep neither. Versions never
 * change once published; these columns are set at insert.
 */

const SOURCE = `("source_text" IS NULL AND "source_digest" IS NULL) OR ("source_text" IS NOT NULL AND "source_digest" ~ '^[0-9a-f]{64}$')`;

export class PolicySource9999600000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(`ALTER TABLE "nodrail"."policy_versions" ADD "source_text" text`);
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD "source_digest" text`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD CONSTRAINT "policy_versions_source" CHECK (${SOURCE})`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP CONSTRAINT "policy_versions_source"`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "source_digest"`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "source_text"`,
    );
  }
}
