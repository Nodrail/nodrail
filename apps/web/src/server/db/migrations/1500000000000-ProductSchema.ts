import type { MigrationInterface, QueryRunner } from "typeorm";

/** Private schema, never exposed through a browser data API. */
export class ProductSchema1500000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query("CREATE SCHEMA nodrail");
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query("DROP SCHEMA nodrail");
  }
}
