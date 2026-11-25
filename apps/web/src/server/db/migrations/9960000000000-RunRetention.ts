import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Retention for runs (R22): a step's findings go with action details after 90
 * days; a run's key and times stay 12 months, then the run and its steps go
 * and its actions, which are kept, lose the link.
 */
export class RunRetention9960000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const table of ["runs", "run_steps"])
      await run(`
        CREATE POLICY maintenance ON nodrail.${table}
          FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
      `);
    // Locking a run before it goes needs UPDATE on one column; nothing else is written.
    await run(
      "GRANT SELECT (workspace_id, id, last_activity_at), UPDATE (last_activity_at), DELETE ON nodrail.runs TO nodrail_maintenance",
    );
    await run(
      "GRANT SELECT (workspace_id, id, run_id, started_at, finished_at, receipt), UPDATE (receipt), DELETE ON nodrail.run_steps TO nodrail_maintenance",
    );
    await run(
      "GRANT UPDATE (run_id, step_key, run_seq) ON nodrail.action_requests TO nodrail_maintenance",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "REVOKE UPDATE (run_id, step_key, run_seq) ON nodrail.action_requests FROM nodrail_maintenance",
    );
    for (const table of ["runs", "run_steps"]) {
      await run(`REVOKE ALL ON nodrail.${table} FROM nodrail_maintenance`);
      await run(`DROP POLICY maintenance ON nodrail.${table}`);
    }
  }
}
