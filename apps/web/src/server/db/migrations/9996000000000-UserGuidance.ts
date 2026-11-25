import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * In-product guidance: which tours a person has seen, the first-steps lists
 * they set aside and the last "What's new" entry they read. One row per person
 * and key; a person reads and writes only their own, in any workspace.
 */
export class UserGuidance9996000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."user_guidance" ("user_id" uuid NOT NULL, "key" text NOT NULL, "value" text, "seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "user_guidance_value" CHECK (length("value") <= 100), CONSTRAINT "user_guidance_key" CHECK ("key" ~ '^[a-z][a-z0-9_:-]{0,99}$'), CONSTRAINT "PK_b577a508c6497c64d20e57e36a9" PRIMARY KEY ("user_id", "key"))`,
    );
    await run(
      `ALTER TABLE "nodrail"."user_guidance" ADD CONSTRAINT "FK_c8edee1b67d8eb37293ef088c24" FOREIGN KEY ("user_id") REFERENCES "nodrail"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    // Not a tenant table: rows belong to a person, whichever workspace is open.
    await run("ALTER TABLE nodrail.user_guidance ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.user_guidance FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY own_guidance ON nodrail.user_guidance
        USING (user_id = nodrail.current_user_id())
        WITH CHECK (user_id = nodrail.current_user_id())
    `);
    await run("GRANT SELECT ON nodrail.user_guidance TO nodrail_member_read");
    await run(
      "GRANT SELECT, INSERT, UPDATE (value, seen_at) ON nodrail.user_guidance TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    // Its policy and grants go with the table.
    await run(
      `ALTER TABLE "nodrail"."user_guidance" DROP CONSTRAINT "FK_c8edee1b67d8eb37293ef088c24"`,
    );
    await run(`DROP TABLE "nodrail"."user_guidance"`);
  }
}
