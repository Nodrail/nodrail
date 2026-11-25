import type { MigrationInterface, QueryRunner } from "typeorm";

const reasons = (list: string[]) =>
  `CHECK ("invalidated_reason" IN (${list.map((item) => `'${item}'`).join(", ")}))`;

const before = [
  "policy_changed",
  "agent_paused",
  "credential_revoked",
  "approver_access_removed",
];

/**
 * A request can close because the agent stopped waiting for it, so nobody
 * approves something nothing will run. Only the check widens; the application
 * role already updates the column.
 */
export class WithdrawnApprovals9980000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "approvals_invalidated_reason"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "approvals_invalidated_reason" ${reasons([...before, "withdrawn"])}`,
    );
  }

  /** Refused while any request was withdrawn: that reason is not rewritten. */
  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "approvals_invalidated_reason"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "approvals_invalidated_reason" ${reasons(before)}`,
    );
  }
}
