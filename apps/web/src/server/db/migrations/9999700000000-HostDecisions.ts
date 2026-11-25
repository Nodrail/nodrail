import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A call the hook decided on its host, recorded where Cloud's own decisions
 * are, so Runs, Activity and run history stay complete. Cloud never
 * decides it again: `decided_by` says who did. The verdict is the row's
 * `initial_evaluation` (allow: ready, deny: denied, require_approval:
 * approval_pending), as for Cloud's own rows; what Cloud can't work out is
 * kept beside it: the rule the host matched and its words, the host's clock,
 * the SHA-256 of the policy file it decided with, and the fingerprint of
 * what it sent, so a retry under the same key is told apart from another
 * payload (409 IDEMPOTENCY_CONFLICT). Cloud's rows carry none of these.
 *
 * Grants: the application role inserts whole rows and may update none of
 * these; the member read role reads the table as before; the metrics role
 * keeps its column list, which names none of them. Retention clears the
 * host's words with the resource they may name (`host_reason`).
 *
 * Every existing row is Cloud's: the default says so, and the checks are
 * added NOT VALID, then validated, so writes keep going meanwhile.
 */

const table = `"nodrail"."action_requests"`;

const CHECKS: Record<string, string> = {
  action_requests_decided_by: `"decided_by" IN ('server', 'host')`,
  action_requests_policy_digest: `"policy_digest" ~ '^[0-9a-f]{64}$'`,
  action_requests_host_rule: `length("host_rule_id") <= 128 AND length("host_rule_name") <= 200`,
  action_requests_host_reason: `length("host_reason") <= 1000`,
  action_requests_host: `("decided_by" = 'server' AND "policy_digest" IS NULL AND "host_rule_id" IS NULL AND "host_rule_name" IS NULL AND "host_reason" IS NULL AND "host_decided_at" IS NULL AND "body_digest" IS NULL) OR ("decided_by" = 'host' AND "host_decided_at" IS NOT NULL AND "body_digest" ~ '^sha256:[0-9a-f]{64}$' AND "initial_evaluation" IN ('ready', 'approval_pending', 'denied') AND "run_hold" IS NULL)`,
};

export class HostDecisions9999700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `ALTER TABLE ${table} ADD "decided_by" text NOT NULL DEFAULT 'server'`,
    );
    await run(`ALTER TABLE ${table} ADD "policy_digest" text`);
    await run(`ALTER TABLE ${table} ADD "host_rule_id" text`);
    await run(`ALTER TABLE ${table} ADD "host_rule_name" text`);
    await run(`ALTER TABLE ${table} ADD "host_reason" text`);
    await run(
      `ALTER TABLE ${table} ADD "host_decided_at" TIMESTAMP WITH TIME ZONE`,
    );
    await run(`ALTER TABLE ${table} ADD "body_digest" text`);
    for (const [name, check] of Object.entries(CHECKS)) {
      await run(
        `ALTER TABLE ${table} ADD CONSTRAINT "${name}" CHECK (${check}) NOT VALID`,
      );
      await run(`ALTER TABLE ${table} VALIDATE CONSTRAINT "${name}"`);
    }
    await run(
      "GRANT UPDATE (host_reason) ON nodrail.action_requests TO nodrail_maintenance",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      "REVOKE UPDATE (host_reason) ON nodrail.action_requests FROM nodrail_maintenance",
    );
    for (const name of Object.keys(CHECKS).reverse())
      await run(`ALTER TABLE ${table} DROP CONSTRAINT "${name}"`);
    // Without its column, a host's row would read as one of Cloud's that may
    // still ask for a permit: each is expired first, so none ever can. It
    // stays in its run's history. Forced row security would hide every
    // workspace's rows from the owner: lifted for this one statement,
    // inside the migration's transaction.
    await run(
      "ALTER TABLE nodrail.action_requests NO FORCE ROW LEVEL SECURITY",
    );
    await run(
      `UPDATE ${table} SET "expires_at" = "created_at" + interval '1 microsecond' WHERE "decided_by" = 'host'`,
    );
    await run("ALTER TABLE nodrail.action_requests FORCE ROW LEVEL SECURITY");
    for (const column of [
      "body_digest",
      "host_decided_at",
      "host_reason",
      "host_rule_name",
      "host_rule_id",
      "policy_digest",
      "decided_by",
    ])
      await run(`ALTER TABLE ${table} DROP COLUMN "${column}"`);
  }
}
