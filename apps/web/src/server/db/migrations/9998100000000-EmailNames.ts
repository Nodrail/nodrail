import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * People were named after the part of their email before the @, which often
 * reads as an ID and can be shared by two people. Nobody can change their
 * name yet, so a name equal to that part was never chosen: it becomes the
 * whole email, as new people are named now. Data only; the schema is
 * unchanged.
 */
export class EmailNames9998100000000 implements MigrationInterface {
  name = "EmailNames9998100000000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(
      `UPDATE nodrail.users
       SET display_name = verified_email
       WHERE verified_email IS NOT NULL
         AND length(verified_email) BETWEEN 1 AND 120
         AND display_name = left(split_part(verified_email, '@', 1), 120)`,
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `UPDATE nodrail.users
       SET display_name = left(split_part(verified_email, '@', 1), 120)
       WHERE verified_email IS NOT NULL AND display_name = verified_email`,
    );
  }
}
