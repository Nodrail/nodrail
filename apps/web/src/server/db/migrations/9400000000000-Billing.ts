import { MigrationInterface, QueryRunner } from "typeorm";

export class Billing9400000000000 implements MigrationInterface {
  name = "Billing9400000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nodrail"."workspace_billing" ("workspace_id" uuid NOT NULL, "plan" text NOT NULL DEFAULT 'free', "status" text NOT NULL DEFAULT 'none', "stripe_customer_id" text, "stripe_subscription_id" text, "current_period_end" TIMESTAMP WITH TIME ZONE, "cancel_at_period_end" boolean NOT NULL DEFAULT false, "past_due_since" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "workspace_billing_plan" CHECK ("plan" IN ('free', 'pro')), CONSTRAINT "PK_99d01f98ffe9098942b800ad868" PRIMARY KEY ("workspace_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "workspace_billing_customer" ON "nodrail"."workspace_billing"  ("stripe_customer_id") WHERE "stripe_customer_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."billing_usage" ("workspace_id" uuid NOT NULL, "period" date NOT NULL, "intents" integer NOT NULL DEFAULT '0', CONSTRAINT "billing_usage_intents" CHECK ("intents" >= 0), CONSTRAINT "PK_d7472bba0f102e649742345a94c" PRIMARY KEY ("workspace_id", "period"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_billing" ADD CONSTRAINT "FK_99d01f98ffe9098942b800ad868" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."billing_usage" ADD CONSTRAINT "FK_f0dda0fa5374f08f87c6dabfeb6" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."billing_usage" DROP CONSTRAINT "FK_f0dda0fa5374f08f87c6dabfeb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_billing" DROP CONSTRAINT "FK_99d01f98ffe9098942b800ad868"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."billing_usage"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."workspace_billing_customer"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."workspace_billing"`);
  }
}
