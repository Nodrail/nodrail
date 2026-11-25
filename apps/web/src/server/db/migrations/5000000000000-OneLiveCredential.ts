import { MigrationInterface, QueryRunner } from "typeorm";

export class OneLiveCredential5000000000000 implements MigrationInterface {
  name = "OneLiveCredential5000000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "installation_credentials_one_live" ON "nodrail"."installation_credentials"  ("workspace_id", "installation_id") WHERE "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "nodrail"."installation_credentials_one_live"`,
    );
  }
}
