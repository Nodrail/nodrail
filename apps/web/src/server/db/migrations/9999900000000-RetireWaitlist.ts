import type { MigrationInterface, QueryRunner } from "typeorm";

/** Existing waitlist data remains available to operators and rollback builds. */
export class RetireWaitlist9999900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query("SET LOCAL lock_timeout = '2s'");
    await queryRunner.query("SET LOCAL statement_timeout = '10s'");
    for (const table of ["waitlist_subscribers", "waitlist_rate_limits"]) {
      const [found]: { comment: string | null }[] = await queryRunner.query(
        "SELECT obj_description(to_regclass($1)) AS comment WHERE to_regclass($1) IS NOT NULL",
        [`public.${table}`],
      );
      if (!found || found.comment !== null) continue;
      await queryRunner.query(`
        COMMENT ON TABLE public.${table} IS
          'Legacy waitlist. Archive before dropping after the server rollback window.'
      `);
    }
  }

  // Do not remove tables, permissions, or operator-supplied comments on rollback.
  async down() {}
}
