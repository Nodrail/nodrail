import { MigrationInterface, QueryRunner } from "typeorm";

export class OpenCheckout9600000000000 implements MigrationInterface {
  name = "OpenCheckout9600000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_billing" ADD "open_checkout_id" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_billing" DROP COLUMN "open_checkout_id"`,
    );
  }
}
