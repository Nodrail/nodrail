import type { MigrationInterface, QueryRunner } from "typeorm";

const tables = ["workspace_billing", "billing_usage"];

export class BillingAccess9500000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const table of tables) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
      await run(`GRANT SELECT, INSERT ON nodrail.${table} TO nodrail_app`);
      await run(`GRANT SELECT ON nodrail.${table} TO nodrail_member_read`);
    }
    await run(
      "GRANT UPDATE (plan, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, past_due_since, updated_at) ON nodrail.workspace_billing TO nodrail_app",
    );
    await run("GRANT UPDATE (intents) ON nodrail.billing_usage TO nodrail_app");
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const table of tables) {
      await run(
        `REVOKE ALL ON nodrail.${table} FROM nodrail_app, nodrail_member_read`,
      );
      await run(`DROP POLICY tenant ON nodrail.${table}`);
      await run(`ALTER TABLE nodrail.${table} NO FORCE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
