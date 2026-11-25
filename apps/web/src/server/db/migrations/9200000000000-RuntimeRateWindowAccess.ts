import type { MigrationInterface, QueryRunner } from "typeorm";

export class RuntimeRateWindowAccess9200000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "ALTER TABLE nodrail.runtime_rate_windows ENABLE ROW LEVEL SECURITY",
    );
    await run(
      "ALTER TABLE nodrail.runtime_rate_windows FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE POLICY tenant ON nodrail.runtime_rate_windows
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(
      "GRANT SELECT, INSERT ON nodrail.runtime_rate_windows TO nodrail_app",
    );
    await run(
      "GRANT UPDATE (window_start, calls) ON nodrail.runtime_rate_windows TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("REVOKE ALL ON nodrail.runtime_rate_windows FROM nodrail_app");
    await run("DROP POLICY tenant ON nodrail.runtime_rate_windows");
    await run(
      "ALTER TABLE nodrail.runtime_rate_windows NO FORCE ROW LEVEL SECURITY",
    );
    await run(
      "ALTER TABLE nodrail.runtime_rate_windows DISABLE ROW LEVEL SECURITY",
    );
  }
}
