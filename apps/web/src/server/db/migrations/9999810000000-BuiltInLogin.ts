import type { MigrationInterface, QueryRunner } from "typeorm";

const oldFunctions = [
  "nodrail.establish_human_session(text, text, text, text, text, text, timestamptz)",
  "nodrail.resolve_human_session(text, text, text, text)",
].join(", ");

// Login connections inherit this role. Tenant connections are never members.
export class BuiltInLogin9999810000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const naming = queryRunner.connection.namingStrategy;
    const pk = (table: string, column: string) =>
      naming.primaryKeyName(`nodrail.${table}`, [column]);
    const fk = (table: string) =>
      naming.foreignKeyName(`nodrail.${table}`, ["user_id"]);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_auth') THEN
          CREATE ROLE nodrail_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END $$;
      REVOKE nodrail_auth FROM nodrail_app;
      GRANT USAGE ON SCHEMA nodrail TO nodrail_auth;

      CREATE TABLE nodrail.login_accounts (
        user_id uuid CONSTRAINT "${pk("login_accounts", "user_id")}" PRIMARY KEY
          CONSTRAINT "${fk("login_accounts")}" REFERENCES nodrail.users(id) ON DELETE RESTRICT,
        email text NOT NULL CONSTRAINT login_accounts_email UNIQUE,
        password_hash text,
        email_verified_at timestamptz
      );
      CREATE TABLE nodrail.login_links (
        digest text CONSTRAINT "${pk("login_links", "digest")}" PRIMARY KEY,
        email text NOT NULL,
        user_id uuid CONSTRAINT "${fk("login_links")}" REFERENCES nodrail.users(id) ON DELETE RESTRICT,
        kind text NOT NULL,
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX login_links_expiry ON nodrail.login_links (expires_at);
      CREATE INDEX login_links_email ON nodrail.login_links (email);
      CREATE TABLE nodrail.login_rate_windows (
        key text CONSTRAINT "${pk("login_rate_windows", "key")}" PRIMARY KEY,
        expires_at timestamptz NOT NULL,
        attempts integer NOT NULL
      );
      CREATE INDEX login_rate_windows_expiry ON nodrail.login_rate_windows (expires_at);

      ALTER TABLE nodrail.human_sessions
        ALTER COLUMN external_auth_account_id DROP NOT NULL,
        ALTER COLUMN provider_session_id DROP NOT NULL,
        ADD COLUMN token_digest text CONSTRAINT human_sessions_token_digest UNIQUE,
        ADD CONSTRAINT "${fk("human_sessions")}" FOREIGN KEY (user_id) REFERENCES nodrail.users(id) ON DELETE RESTRICT,
        ADD CONSTRAINT human_sessions_login_source CHECK (
          (token_digest IS NOT NULL AND external_auth_account_id IS NULL AND provider_session_id IS NULL)
          OR (token_digest IS NULL AND external_auth_account_id IS NOT NULL AND provider_session_id IS NOT NULL)
        );
      CREATE INDEX human_sessions_user ON nodrail.human_sessions (user_id);

      -- Reserve verified addresses even while the profile is suspended.
      -- A case-insensitive collision aborts the migration. An operator must
      -- resolve ownership before either account can authenticate by email.
      INSERT INTO nodrail.login_accounts (user_id, email, email_verified_at)
      SELECT id, lower(btrim(verified_email)), statement_timestamp()
      FROM nodrail.users
      WHERE nullif(btrim(verified_email), '') IS NOT NULL;

      ALTER TABLE nodrail.login_accounts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.login_links ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.login_rate_windows ENABLE ROW LEVEL SECURITY;
      CREATE POLICY auth_accounts ON nodrail.login_accounts TO nodrail_auth USING (true) WITH CHECK (true);
      CREATE POLICY auth_links ON nodrail.login_links TO nodrail_auth USING (true) WITH CHECK (true);
      CREATE POLICY auth_rate_windows ON nodrail.login_rate_windows TO nodrail_auth USING (true) WITH CHECK (true);

      ALTER POLICY visible_users ON nodrail.users TO nodrail_app, nodrail_member_read;
      ALTER POLICY own_sessions ON nodrail.human_sessions TO nodrail_app;
      CREATE POLICY auth_users ON nodrail.users TO nodrail_auth USING (true) WITH CHECK (true);
      CREATE POLICY auth_sessions ON nodrail.human_sessions TO nodrail_auth
        USING (token_digest IS NOT NULL) WITH CHECK (token_digest IS NOT NULL);
      GRANT SELECT (id, status), INSERT (display_name, verified_email) ON nodrail.users TO nodrail_auth;
      GRANT SELECT (user_id, id, token_digest, expires_at, revoked_at),
        INSERT (user_id, token_digest, expires_at), DELETE, UPDATE (revoked_at)
        ON nodrail.human_sessions TO nodrail_auth;
      GRANT SELECT (user_id, email, password_hash),
        INSERT (user_id, email, password_hash, email_verified_at), UPDATE (password_hash)
        ON nodrail.login_accounts TO nodrail_auth;
      GRANT SELECT, INSERT, DELETE ON nodrail.login_links TO nodrail_auth;
      GRANT SELECT, INSERT, UPDATE, DELETE ON nodrail.login_rate_windows TO nodrail_auth;
      REVOKE EXECUTE ON FUNCTION ${oldFunctions} FROM nodrail_app;
    `);
    await queryRunner.query(`
      CREATE FUNCTION nodrail.forget_login() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
      BEGIN
        DELETE FROM nodrail.login_links
        WHERE email = lower(btrim(OLD.verified_email));
        DELETE FROM nodrail.login_accounts WHERE user_id = OLD.id;
        RETURN NEW;
      END
      $$;
      REVOKE ALL ON FUNCTION nodrail.forget_login() FROM PUBLIC;
      CREATE TRIGGER forget_login AFTER UPDATE ON nodrail.users
      FOR EACH ROW WHEN (OLD.verified_email IS NOT NULL AND NEW.verified_email IS NULL)
      EXECUTE FUNCTION nodrail.forget_login();
    `);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`
      DROP TRIGGER forget_login ON nodrail.users;
      DROP FUNCTION nodrail.forget_login();
      DELETE FROM nodrail.human_sessions WHERE token_digest IS NOT NULL;
      DROP POLICY auth_sessions ON nodrail.human_sessions;
      REVOKE DELETE, SELECT (user_id, id, token_digest, expires_at, revoked_at),
        INSERT (user_id, token_digest, expires_at), UPDATE (revoked_at)
        ON nodrail.human_sessions FROM nodrail_auth;
      ALTER TABLE nodrail.human_sessions DROP CONSTRAINT human_sessions_login_source,
        DROP CONSTRAINT human_sessions_token_digest,
        DROP COLUMN token_digest, DROP CONSTRAINT "${queryRunner.connection.namingStrategy.foreignKeyName("nodrail.human_sessions", ["user_id"])}",
        ALTER COLUMN external_auth_account_id SET NOT NULL,
        ALTER COLUMN provider_session_id SET NOT NULL;
      DROP INDEX nodrail.human_sessions_user;
      DROP POLICY auth_users ON nodrail.users;
      ALTER POLICY visible_users ON nodrail.users TO public;
      ALTER POLICY own_sessions ON nodrail.human_sessions TO public;
      REVOKE SELECT (id, status), INSERT (display_name, verified_email)
        ON nodrail.users FROM nodrail_auth;
      DROP TABLE nodrail.login_links, nodrail.login_accounts, nodrail.login_rate_windows;
      REVOKE USAGE ON SCHEMA nodrail FROM nodrail_auth;
      GRANT EXECUTE ON FUNCTION ${oldFunctions} TO nodrail_app;
    `);
  }
}
