import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Run steps a workspace records per UTC month, next to its governed actions.
 * Steps are never billed; the allowance only bounds what one installation can
 * store (R51).
 */
export class StepAllowance9970000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."billing_usage" ADD "steps" integer NOT NULL DEFAULT '0'`,
    );
    await run(
      `ALTER TABLE "nodrail"."billing_usage" ADD CONSTRAINT "billing_usage_steps" CHECK ("steps" >= 0)`,
    );
    await run("GRANT UPDATE (steps) ON nodrail.billing_usage TO nodrail_app");
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "REVOKE UPDATE (steps) ON nodrail.billing_usage FROM nodrail_app",
    );
    await run(
      `ALTER TABLE "nodrail"."billing_usage" DROP CONSTRAINT "billing_usage_steps"`,
    );
    await run(`ALTER TABLE "nodrail"."billing_usage" DROP COLUMN "steps"`);
  }
}
