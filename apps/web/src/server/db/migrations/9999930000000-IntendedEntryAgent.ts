import type { MigrationInterface, QueryRunner } from "typeorm";

export class IntendedEntryAgent9999930000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      "ALTER TABLE nodrail.intended_revisions ADD COLUMN entry_agent text",
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      "ALTER TABLE nodrail.intended_revisions DROP COLUMN entry_agent",
    );
  }
}
