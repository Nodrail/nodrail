import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Personal access tokens for the personal API (`ndp_…`). A token belongs to
 * one person in one workspace and only its digest is kept. A decision made
 * with one is recorded against the token instead of a browser session, and
 * the audit event names it, so Activity can say "via API token <name>". Both
 * links include the person, so a token can never be recorded as acting for
 * someone else.
 */
export class ApiTokens9995000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    // Fail fast rather than queue requests behind a busy approvals table.
    await run("SET LOCAL lock_timeout = '5s'");
    await run(
      `CREATE TABLE "nodrail"."personal_access_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "name" text NOT NULL, "public_prefix" text NOT NULL, "secret_digest" text NOT NULL, "scopes" text array NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE, "last_used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by" uuid, "rate_window_start" TIMESTAMP WITH TIME ZONE, "rate_window_calls" integer NOT NULL DEFAULT '0', CONSTRAINT "UQ_38736aa6608f7b799eb3bec51bd" UNIQUE ("workspace_id", "id", "user_id"), CONSTRAINT "UQ_81bbffb88db7d66d13fda664a4d" UNIQUE ("public_prefix"), CONSTRAINT "personal_access_tokens_revoked" CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL)), CONSTRAINT "personal_access_tokens_expiry" CHECK ("expires_at" IS NULL OR "expires_at" > "created_at"), CONSTRAINT "personal_access_tokens_scopes" CHECK ("scopes" <@ ARRAY['read', 'decide', 'rules:write']::text[] AND 'read' = ANY ("scopes")), CONSTRAINT "personal_access_tokens_name" CHECK (length("name") BETWEEN 1 AND 60), CONSTRAINT "personal_access_tokens_prefix" CHECK ("public_prefix" ~ '^[0-9a-f]{12}$'), CONSTRAINT "PK_b6dc462fa11dbbb897eb8419735" PRIMARY KEY ("id"))`,
    );
    await run(
      `CREATE INDEX "personal_access_tokens_owner" ON "nodrail"."personal_access_tokens"  ("workspace_id", "user_id") `,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD "decided_token_id" uuid`,
    );
    await run(`ALTER TABLE "nodrail"."audit_events" ADD "actor_token_id" uuid`);
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" ADD CONSTRAINT "FK_206072f024544f427eb5837946a" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" ADD CONSTRAINT "FK_9b1b1aa8d0b404eccb7f711d7b7" FOREIGN KEY ("workspace_id", "revoked_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "FK_98811be2617992f8b23029e57a8" FOREIGN KEY ("decided_token_id", "workspace_id", "decided_by") REFERENCES "nodrail"."personal_access_tokens"("id","workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await run(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_7366af5a32f14e01761a0fa85e2" FOREIGN KEY ("actor_token_id", "workspace_id", "actor_user_id") REFERENCES "nodrail"."personal_access_tokens"("id","workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await run(
      "GRANT UPDATE (decided_token_id) ON nodrail.approval_requests TO nodrail_app",
    );
    // A decision is a browser session's or a token's, never both or neither.
    // Added without holding writes back, then validated.
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "approvals_decided"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "approvals_decided" CHECK ("state" NOT IN ('approved_once', 'denied') OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND num_nonnulls("decided_session_id", "decided_token_id") = 1)) NOT VALID`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" VALIDATE CONSTRAINT "approvals_decided"`,
    );

    // A tenant table, but not forced on its owner: a call arrives with a
    // token and no workspace, and the lookup below must see across them, as
    // for installation credentials.
    await run(
      "ALTER TABLE nodrail.personal_access_tokens ENABLE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE POLICY tenant ON nodrail.personal_access_tokens
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(
      "GRANT SELECT, INSERT ON nodrail.personal_access_tokens TO nodrail_app",
    );
    await run(
      `GRANT UPDATE (last_used_at, revoked_at, revoked_by, rate_window_start, rate_window_calls)
       ON nodrail.personal_access_tokens TO nodrail_app`,
    );
    // Screens list tokens and say who decided "via API token"; they never
    // need the digest or the rate counter.
    await run(
      `GRANT SELECT (id, workspace_id, user_id, name, public_prefix, scopes,
                     created_at, expires_at, last_used_at, revoked_at)
       ON nodrail.personal_access_tokens TO nodrail_member_read`,
    );

    await run(`
      CREATE FUNCTION nodrail.workspace_for_personal_token(p_public_prefix text)
        RETURNS uuid
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = ''
        AS $$
          SELECT t.workspace_id FROM nodrail.personal_access_tokens t
          WHERE t.public_prefix = p_public_prefix
        $$
    `);
    await run(
      "REVOKE ALL ON FUNCTION nodrail.workspace_for_personal_token(text) FROM PUBLIC",
    );
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.workspace_for_personal_token(text) TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run("DROP FUNCTION nodrail.workspace_for_personal_token(text)");
    // Token decisions cannot be kept without the token they name.
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "approvals_decided"`,
    );
    await run(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_7366af5a32f14e01761a0fa85e2"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "FK_98811be2617992f8b23029e57a8"`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" DROP CONSTRAINT "FK_9b1b1aa8d0b404eccb7f711d7b7"`,
    );
    await run(
      `ALTER TABLE "nodrail"."personal_access_tokens" DROP CONSTRAINT "FK_206072f024544f427eb5837946a"`,
    );
    await run(
      `ALTER TABLE "nodrail"."audit_events" DROP COLUMN "actor_token_id"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" DROP COLUMN "decided_token_id"`,
    );
    await run(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "approvals_decided" CHECK ("state" NOT IN ('approved_once', 'denied') OR ("decided_by" IS NOT NULL AND "decided_session_id" IS NOT NULL AND "decided_at" IS NOT NULL)) NOT VALID`,
    );
    await run(`DROP INDEX "nodrail"."personal_access_tokens_owner"`);
    // Its policy and grants go with the table.
    await run(`DROP TABLE "nodrail"."personal_access_tokens"`);
  }
}
