import type { MigrationInterface, QueryRunner } from "typeorm";

const tables = ["waitlist_subscribers", "waitlist_rate_limits"];

/**
 * These live in the public schema, which a hosted Postgres can expose to its
 * own API. With row level security on and no policy for those roles, they see
 * nothing. Only the server's own role can use the tables.
 */
export class WaitlistRowSecurity9800000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const table of tables) {
      await run(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY server_only ON public.${table}
          TO nodrail_app USING (true) WITH CHECK (true)
      `);
      await run(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO nodrail_app`,
      );
    }
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    for (const table of tables) {
      await run(`REVOKE ALL ON public.${table} FROM nodrail_app`);
      await run(`DROP POLICY server_only ON public.${table}`);
      await run(`ALTER TABLE public.${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
