import { MigrationInterface, QueryRunner } from "typeorm";

export class NotificationOutbox8000000000000 implements MigrationInterface {
  name = "NotificationOutbox8000000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nodrail"."notification_outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "kind" text NOT NULL, "channel" text NOT NULL DEFAULT 'email', "recipient_user_id" uuid NOT NULL, "recipient_email" text NOT NULL, "payload_safe" jsonb NOT NULL DEFAULT '{}', "dedupe_key" text NOT NULL, "state" text NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT '0', "available_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "lease_until" TIMESTAMP WITH TIME ZONE, "delivered_at" TIMESTAMP WITH TIME ZONE, "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_e5fb53b1367f724ae2351a7da6d" UNIQUE ("workspace_id", "dedupe_key"), CONSTRAINT "notification_payload" CHECK (pg_column_size("payload_safe") <= 4096), CONSTRAINT "notification_attempts" CHECK ("attempts" >= 0), CONSTRAINT "notification_channel" CHECK ("channel" = 'email'), CONSTRAINT "notification_state" CHECK ("state" IN ('pending', 'sending', 'delivered', 'failed', 'dropped')), CONSTRAINT "notification_kind" CHECK ("kind" IN ('approval_requested', 'new_permission', 'integration_stale')), CONSTRAINT "PK_83d47c7dba1da2d038749fe757e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "notification_outbox_due" ON "nodrail"."notification_outbox"  ("state", "available_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."notification_outbox" ADD CONSTRAINT "FK_e45b41b1c3a12539c2e81488cf1" FOREIGN KEY ("workspace_id", "recipient_user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."notification_outbox" DROP CONSTRAINT "FK_e45b41b1c3a12539c2e81488cf1"`,
    );
    await queryRunner.query(`DROP INDEX "nodrail"."notification_outbox_due"`);
    await queryRunner.query(`DROP TABLE "nodrail"."notification_outbox"`);
  }
}
