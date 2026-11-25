import type { MigrationInterface, QueryRunner } from "typeorm";

const cleaned = [
  "notification_outbox",
  "action_requests",
  "observed_permissions",
  "client_reports",
  "audit_events",
];

/**
 * Retention runs as its own role: the application role can never rewrite the
 * audit log. Erasure needs one narrow function, because the application role has
 * no write access to users.
 */
export class DataLifecycle9700000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_maintenance') THEN
          CREATE ROLE nodrail_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$
    `);
    await run(
      "GRANT nodrail_maintenance TO nodrail_app WITH INHERIT FALSE, SET TRUE",
    );
    await run("GRANT USAGE ON SCHEMA nodrail TO nodrail_maintenance");
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.current_workspace_id() TO nodrail_maintenance",
    );
    for (const table of cleaned) {
      await run(`GRANT SELECT ON nodrail.${table} TO nodrail_maintenance`);
      await run(`
        CREATE POLICY maintenance ON nodrail.${table}
          FOR ALL TO nodrail_maintenance USING (true) WITH CHECK (true)
      `);
    }
    await run(
      "GRANT DELETE ON nodrail.notification_outbox TO nodrail_maintenance",
    );
    await run(
      "GRANT UPDATE (params_safe, resource_id) ON nodrail.action_requests TO nodrail_maintenance",
    );
    await run(
      "GRANT UPDATE (resource_label) ON nodrail.observed_permissions TO nodrail_maintenance",
    );
    await run(
      "GRANT UPDATE (details_safe) ON nodrail.client_reports TO nodrail_maintenance",
    );
    await run(
      "GRANT UPDATE (payload_safe) ON nodrail.audit_events TO nodrail_maintenance",
    );

    await run(
      "GRANT UPDATE (open_checkout_id) ON nodrail.workspace_billing TO nodrail_app",
    );
    await run(
      "GRANT UPDATE (state, recipient_email) ON nodrail.notification_outbox TO nodrail_app",
    );
    await run(
      "GRANT UPDATE (normalized_email) ON nodrail.workspace_invites TO nodrail_app",
    );

    await run(`
      CREATE FUNCTION nodrail.erase_current_user() RETURNS void
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
      DECLARE
        v_user uuid := nodrail.current_user_id();
      BEGIN
        IF v_user IS NULL THEN
          RAISE EXCEPTION 'no current user';
        END IF;
        UPDATE nodrail.users
        SET display_name = 'Deleted user', verified_email = NULL, status = 'suspended'
        WHERE id = v_user;
        UPDATE nodrail.human_sessions SET revoked_at = clock_timestamp()
        WHERE user_id = v_user AND revoked_at IS NULL;
        -- Freed, so the same address can sign up again as a new person.
        UPDATE nodrail.external_auth_accounts
        SET subject = 'erased:' || gen_random_uuid()::text
        WHERE user_id = v_user;
      END
      $$
    `);
    await run(
      "REVOKE ALL ON FUNCTION nodrail.erase_current_user() FROM PUBLIC",
    );
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.erase_current_user() TO nodrail_app",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("DROP FUNCTION nodrail.erase_current_user()");
    await run(
      "REVOKE UPDATE (normalized_email) ON nodrail.workspace_invites FROM nodrail_app",
    );
    await run(
      "REVOKE UPDATE (open_checkout_id) ON nodrail.workspace_billing FROM nodrail_app",
    );
    await run(
      "REVOKE UPDATE (state, recipient_email) ON nodrail.notification_outbox FROM nodrail_app",
    );
    for (const table of cleaned) {
      await run(`DROP POLICY maintenance ON nodrail.${table}`);
      await run(`REVOKE ALL ON nodrail.${table} FROM nodrail_maintenance`);
    }
    await run(
      "REVOKE EXECUTE ON FUNCTION nodrail.current_workspace_id() FROM nodrail_maintenance",
    );
    await run("REVOKE USAGE ON SCHEMA nodrail FROM nodrail_maintenance");
    await run("REVOKE nodrail_maintenance FROM nodrail_app");
  }
}
