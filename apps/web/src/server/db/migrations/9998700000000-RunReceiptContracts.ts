import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A step's receipt read against a declared contract: the run keeps
 * the engine's receipt record, whose value a receipt block of up to 8 KiB
 * can fill, so a step's receipt may now take 16 KiB instead of 4. Existing
 * rows already fit. Going down fails loudly if a larger row exists.
 */
export class RunReceiptContracts9998700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."run_steps" DROP CONSTRAINT "run_steps_receipt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."run_steps" ADD CONSTRAINT "run_steps_receipt" CHECK (pg_column_size("receipt") <= 16384)`,
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."run_steps" DROP CONSTRAINT "run_steps_receipt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."run_steps" ADD CONSTRAINT "run_steps_receipt" CHECK (pg_column_size("receipt") <= 4096)`,
    );
  }
}
