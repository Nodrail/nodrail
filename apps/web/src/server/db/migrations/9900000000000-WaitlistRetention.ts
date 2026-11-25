import type { MigrationInterface, QueryRunner } from "typeorm";

/** Lets the retention job honour the privacy notice's 12 months, and nothing else. */
export class WaitlistRetention9900000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      "GRANT SELECT (id, created_at), DELETE ON public.waitlist_subscribers TO nodrail_maintenance",
    );
    await queryRunner.query(`
      CREATE POLICY maintenance ON public.waitlist_subscribers
        TO nodrail_maintenance USING (true)
    `);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      "DROP POLICY maintenance ON public.waitlist_subscribers",
    );
    await queryRunner.query(
      "REVOKE ALL ON public.waitlist_subscribers FROM nodrail_maintenance",
    );
  }
}
