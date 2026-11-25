import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * A runtime call arrives with a credential and no workspace, so row level
 * security hides everything until one is known. This function answers one
 * question: which workspace owns this public prefix. The secret is checked
 * afterwards, inside that workspace's context.
 *
 * installation_credentials stops forcing row level security on its owner so the
 * function can look across workspaces. The application role stays subject to it.
 */
export class CredentialLookup7000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "ALTER TABLE nodrail.installation_credentials NO FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE FUNCTION nodrail.workspace_for_credential(p_public_prefix text)
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = ''
        AS $$
          SELECT c.workspace_id FROM nodrail.installation_credentials c
          WHERE c.public_prefix = p_public_prefix
        $$
    `);
    await run(
      "REVOKE ALL ON FUNCTION nodrail.workspace_for_credential(text) FROM PUBLIC",
    );
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.workspace_for_credential(text) TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("DROP FUNCTION nodrail.workspace_for_credential(text)");
    await run(
      "ALTER TABLE nodrail.installation_credentials FORCE ROW LEVEL SECURITY",
    );
  }
}
