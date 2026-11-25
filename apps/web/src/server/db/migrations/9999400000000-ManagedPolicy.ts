import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A connected policy version published by `nodrail apply` records the
 * project's id, its workspace revision and its effective policy's digest.
 * Versions made on screen or by `rules push` name none. `plan` compares the
 * live version with its lock, so an edit made elsewhere shows as drift.
 *
 * Versions never change once published; these columns are set at insert.
 */

const MANAGED = `("managed_project_id" IS NULL AND "managed_revision" IS NULL AND "managed_policy_revision" IS NULL) OR ("managed_project_id" IS NOT NULL AND "managed_revision" ~ '^[0-9a-f]{64}$' AND ("managed_policy_revision" IS NULL OR "managed_policy_revision" ~ '^[0-9a-f]{64}$'))`;

export class ManagedPolicy9999400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD "managed_project_id" uuid`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD "managed_revision" text`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD "managed_policy_revision" text`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" ADD CONSTRAINT "policy_versions_managed" CHECK (${MANAGED})`,
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP CONSTRAINT "policy_versions_managed"`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "managed_policy_revision"`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "managed_revision"`,
    );
    await run(
      `ALTER TABLE "nodrail"."policy_versions" DROP COLUMN "managed_project_id"`,
    );
  }
}
