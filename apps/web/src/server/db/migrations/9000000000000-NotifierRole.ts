import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * The delivery process crosses workspaces, so it has its own role that can read
 * the outbox and the list of workspace IDs and nothing else. It has no route to
 * approvals, permits or policies: an email cannot grant anything.
 */
export class NotifierRole9000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_notifier') THEN
          CREATE ROLE nodrail_notifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$
    `);
    await run(
      "GRANT nodrail_notifier TO nodrail_app WITH INHERIT FALSE, SET TRUE",
    );
    await run("GRANT USAGE ON SCHEMA nodrail TO nodrail_notifier");
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.current_workspace_id(), nodrail.current_user_id() TO nodrail_notifier",
    );

    await run(
      "ALTER TABLE nodrail.notification_outbox ENABLE ROW LEVEL SECURITY",
    );
    await run(
      "ALTER TABLE nodrail.notification_outbox FORCE ROW LEVEL SECURITY",
    );
    await run(`
      CREATE POLICY tenant ON nodrail.notification_outbox
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id())
    `);
    await run(`
      CREATE POLICY notifier_delivery ON nodrail.notification_outbox
        FOR ALL TO nodrail_notifier USING (true) WITH CHECK (true)
    `);
    await run(
      "GRANT INSERT, SELECT ON nodrail.notification_outbox TO nodrail_app",
    );
    await run(
      "GRANT SELECT ON nodrail.notification_outbox TO nodrail_notifier",
    );
    await run(
      "GRANT UPDATE (state, attempts, available_at, lease_until, delivered_at, last_error) ON nodrail.notification_outbox TO nodrail_notifier",
    );

    // Every permissive policy is evaluated, and this one reads memberships, which
    // the notifier must not. It was only ever meant for people.
    await run(
      "ALTER POLICY own_workspaces ON nodrail.workspaces TO nodrail_app, nodrail_member_read",
    );
    await run(`
      CREATE POLICY notifier_list ON nodrail.workspaces
        FOR SELECT TO nodrail_notifier USING (archived_at IS NULL)
    `);
    await run(
      "GRANT SELECT (id, archived_at) ON nodrail.workspaces TO nodrail_notifier",
    );
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("DROP POLICY notifier_list ON nodrail.workspaces");
    await run("ALTER POLICY own_workspaces ON nodrail.workspaces TO public");
    await run("DROP POLICY notifier_delivery ON nodrail.notification_outbox");
    await run("DROP POLICY tenant ON nodrail.notification_outbox");
    await run(
      "REVOKE ALL ON nodrail.notification_outbox FROM nodrail_app, nodrail_notifier",
    );
    await run(
      "REVOKE ALL (id, archived_at) ON nodrail.workspaces FROM nodrail_notifier",
    );
    await run(
      "REVOKE EXECUTE ON FUNCTION nodrail.current_workspace_id(), nodrail.current_user_id() FROM nodrail_notifier",
    );
    await run("REVOKE USAGE ON SCHEMA nodrail FROM nodrail_notifier");
    await run("REVOKE nodrail_notifier FROM nodrail_app");
  }
}
