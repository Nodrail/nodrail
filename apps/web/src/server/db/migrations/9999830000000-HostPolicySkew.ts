import type { MigrationInterface, QueryRunner } from "typeorm";

export class HostPolicySkew9999830000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run("ALTER TABLE nodrail.action_requests ADD policy_skew boolean");
    await run(`ALTER TABLE nodrail.installations
      ADD heartbeat_policy_digest text,
      ADD heartbeat_policy_skew boolean,
      ADD CONSTRAINT installations_heartbeat_policy_digest
        CHECK ("heartbeat_policy_digest" ~ '^[0-9a-f]{64}$')`);
    await run(
      "GRANT UPDATE (heartbeat_policy_digest, heartbeat_policy_skew) ON nodrail.installations TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      "ALTER TABLE nodrail.installations DROP heartbeat_policy_skew, DROP heartbeat_policy_digest",
    );
    await queryRunner.query(
      "ALTER TABLE nodrail.action_requests DROP policy_skew",
    );
  }
}
