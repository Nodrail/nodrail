import { MigrationInterface, QueryRunner } from "typeorm";

export class RuntimeRateWindow9100000000000 implements MigrationInterface {
  name = "RuntimeRateWindow9100000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nodrail"."runtime_rate_windows" ("workspace_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "window_start" TIMESTAMP WITH TIME ZONE NOT NULL, "calls" integer NOT NULL, CONSTRAINT "PK_f78fc7e2c6239dc4c7c6d7b9912" PRIMARY KEY ("workspace_id", "installation_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."runtime_rate_windows" ADD CONSTRAINT "FK_f78fc7e2c6239dc4c7c6d7b9912" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."runtime_rate_windows" DROP CONSTRAINT "FK_f78fc7e2c6239dc4c7c6d7b9912"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."runtime_rate_windows"`);
  }
}
