import { readFileSync } from "node:fs";
import type { MigrationInterface, QueryRunner } from "typeorm";

/** Adopts the existing waitlist tables, and skips them if already present. */
export class Waitlist1000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    if (await queryRunner.hasTable("waitlist_subscribers")) return;
    await queryRunner.query(
      readFileSync("migrations/0001_waitlist.sql", "utf8"),
    );
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      "DROP TABLE waitlist_rate_limits; DROP TABLE waitlist_subscribers",
    );
  }
}
