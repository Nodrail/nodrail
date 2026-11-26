import type { MigrationInterface } from "typeorm";

/** Keep the historical migration name. New installations have no waitlist. */
export class Waitlist1000000000000 implements MigrationInterface {
  async up() {}

  // Existing tables predate this bootstrap and stay available for rollback.
  async down() {}
}
