import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * An invited person has no membership, so row level security hides the invite
 * from them. This function answers one question: which workspace does this
 * token digest belong to. Everything after it runs in that workspace's context.
 *
 * workspace_invites stops forcing row level security on its owner so the
 * function, which runs as that owner, can look across workspaces. The
 * application role remains fully subject to the policies.
 */
export class InviteLookup6000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "ALTER TABLE nodrail.workspace_invites NO FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE FUNCTION nodrail.workspace_for_invite(p_token_digest text)
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = ''
        AS $$
          SELECT i.workspace_id FROM nodrail.workspace_invites i
          WHERE i.token_digest = p_token_digest
        $$
    `);
    await run(
      "REVOKE ALL ON FUNCTION nodrail.workspace_for_invite(text) FROM PUBLIC",
    );
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.workspace_for_invite(text) TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("DROP FUNCTION nodrail.workspace_for_invite(text)");
    await run("ALTER TABLE nodrail.workspace_invites FORCE ROW LEVEL SECURITY");
  }
}
