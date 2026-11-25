import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sign-in happens before anyone has a workspace or a user context, so it cannot
 * pass through row level security. These two functions are the only way in:
 * they take an identity the server has already verified and do nothing else.
 *
 * users and human_sessions stop forcing row level security on their owner so
 * these functions, which run as that owner, can work. The application role
 * remains fully subject to the policies and has no write access to users.
 */
export class Identity4000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);

    await run("ALTER TABLE nodrail.users NO FORCE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.human_sessions NO FORCE ROW LEVEL SECURITY");

    await run(`
      CREATE FUNCTION nodrail.establish_human_session(
        p_provider text,
        p_issuer text,
        p_subject text,
        p_provider_session_id text,
        p_email text,
        p_display_name text,
        p_expires_at timestamptz
      ) RETURNS TABLE (user_id uuid, session_id uuid)
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
      DECLARE
        v_user uuid;
        v_account uuid;
        v_session uuid;
      BEGIN
        -- Two first sign-ins at once must not create two people.
        PERFORM pg_advisory_xact_lock(
          hashtextextended(p_provider || '|' || p_issuer || '|' || p_subject, 0)
        );

        SELECT a.id, a.user_id INTO v_account, v_user
        FROM nodrail.external_auth_accounts a
        WHERE a.provider = p_provider AND a.issuer = p_issuer AND a.subject = p_subject;

        IF v_account IS NULL THEN
          INSERT INTO nodrail.users (display_name, verified_email)
          VALUES (p_display_name, p_email)
          RETURNING id INTO v_user;
          INSERT INTO nodrail.external_auth_accounts (user_id, provider, issuer, subject)
          VALUES (v_user, p_provider, p_issuer, p_subject)
          RETURNING id INTO v_account;
        ELSE
          UPDATE nodrail.users SET verified_email = p_email WHERE id = v_user;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM nodrail.users u WHERE u.id = v_user AND u.status = 'active'
        ) THEN
          RETURN;
        END IF;

        INSERT INTO nodrail.human_sessions
          (user_id, external_auth_account_id, provider_session_id, expires_at)
        VALUES (v_user, v_account, p_provider_session_id, p_expires_at)
        ON CONFLICT (external_auth_account_id, provider_session_id) DO NOTHING
        RETURNING id INTO v_session;

        -- A repeated sign-in may reuse a live session, never revive a closed one.
        IF v_session IS NULL THEN
          SELECT s.id INTO v_session
          FROM nodrail.human_sessions s
          WHERE s.external_auth_account_id = v_account
            AND s.provider_session_id = p_provider_session_id
            AND s.revoked_at IS NULL
            AND s.expires_at > clock_timestamp();
        END IF;

        IF v_session IS NOT NULL THEN
          user_id := v_user;
          session_id := v_session;
          RETURN NEXT;
        END IF;
      END
      $$
    `);

    await run(`
      CREATE FUNCTION nodrail.resolve_human_session(
        p_provider text,
        p_issuer text,
        p_subject text,
        p_provider_session_id text
      ) RETURNS TABLE (user_id uuid, session_id uuid)
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = ''
        AS $$
          SELECT s.user_id, s.id
          FROM nodrail.external_auth_accounts a
          JOIN nodrail.human_sessions s
            ON s.external_auth_account_id = a.id AND s.user_id = a.user_id
          JOIN nodrail.users u ON u.id = a.user_id
          WHERE a.provider = p_provider
            AND a.issuer = p_issuer
            AND a.subject = p_subject
            AND s.provider_session_id = p_provider_session_id
            AND s.revoked_at IS NULL
            AND s.expires_at > clock_timestamp()
            AND u.status = 'active'
        $$
    `);

    for (const signature of [
      "establish_human_session(text, text, text, text, text, text, timestamptz)",
      "resolve_human_session(text, text, text, text)",
    ]) {
      await run(`REVOKE ALL ON FUNCTION nodrail.${signature} FROM PUBLIC`);
      await run(
        `GRANT EXECUTE ON FUNCTION nodrail.${signature} TO nodrail_app`,
      );
    }
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "DROP FUNCTION nodrail.resolve_human_session(text, text, text, text)",
    );
    await run(
      "DROP FUNCTION nodrail.establish_human_session(text, text, text, text, text, text, timestamptz)",
    );
    await run("ALTER TABLE nodrail.users FORCE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.human_sessions FORCE ROW LEVEL SECURITY");
  }
}
