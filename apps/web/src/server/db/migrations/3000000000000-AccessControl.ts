import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * What entities cannot express: database roles, row level security, grants and
 * the owner trigger. Written by hand; the drift check ignores all of it.
 */
const tenantTables = [
  "workspace_memberships",
  "workspace_invites",
  "notification_preferences",
  "environments",
  "policy_versions",
  "active_policies",
  "policy_rules",
  "agents",
  "agent_members",
  "installations",
  "installation_credentials",
  "observed_permissions",
  "action_requests",
  "approval_requests",
  "decision_permits",
  "client_reports",
  "audit_events",
];

const inAgents = "agent_id IN (SELECT id FROM nodrail.agents)";
const inInstallations =
  "installation_id IN (SELECT id FROM nodrail.installations)";
const inRequests =
  "action_request_id IN (SELECT id FROM nodrail.action_requests)";

/** Per-person limits, applied only to the role that screens read through. */
const memberScope: Record<string, string> = {
  agents: `(SELECT nodrail.sees_whole_workspace()) OR id IN (
    SELECT agent_id FROM nodrail.agent_members
    WHERE user_id = nodrail.current_user_id())`,
  installations: inAgents,
  action_requests: inAgents,
  approval_requests: inRequests,
  decision_permits: inRequests,
  client_reports: inRequests,
  installation_credentials: inInstallations,
  observed_permissions: inInstallations,
  policy_rules: `agent_id IS NULL OR ${inAgents}`,
  audit_events: `(SELECT nodrail.sees_whole_workspace())
    OR actor_user_id = nodrail.current_user_id()
    OR ${inAgents}`,
};

export class AccessControl3000000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);

    await run(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_app') THEN
          CREATE ROLE nodrail_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nodrail_member_read') THEN
          CREATE ROLE nodrail_member_read NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
      END
      $$
    `);
    // INHERIT FALSE matters: a policy written TO a role also binds anyone who
    // inherits it, which would limit security steps to the caller's own rows.
    await run(
      "GRANT nodrail_member_read TO nodrail_app WITH INHERIT FALSE, SET TRUE",
    );

    await run(`
      CREATE FUNCTION nodrail.current_workspace_id() RETURNS uuid
        LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('nodrail.workspace_id', true), '')::uuid $$
    `);
    await run(`
      CREATE FUNCTION nodrail.current_user_id() RETURNS uuid
        LANGUAGE sql STABLE
        AS $$ SELECT NULLIF(current_setting('nodrail.user_id', true), '')::uuid $$
    `);
    await run(`
      CREATE FUNCTION nodrail.sees_whole_workspace() RETURNS boolean
        LANGUAGE sql STABLE
        AS $$
          SELECT EXISTS (
            SELECT 1 FROM nodrail.workspace_memberships m
            WHERE m.workspace_id = nodrail.current_workspace_id()
              AND m.user_id = nodrail.current_user_id()
              AND m.status = 'active'
              AND m.role IN ('admin', 'policy_manager'))
        $$
    `);

    // CHECK constraints keep an owner active and admin, and a unique index
    // allows one. Only "there is still an owner" spans rows and needs a trigger.
    await run(`
      CREATE FUNCTION nodrail.check_workspace_has_owner() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
      DECLARE
        target uuid;
      BEGIN
        IF TG_TABLE_NAME = 'workspaces' THEN
          target := NEW.id;
        ELSE
          target := NEW.workspace_id;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM nodrail.workspace_memberships m
          WHERE m.workspace_id = target AND m.is_owner
        ) THEN
          RAISE EXCEPTION 'workspace must have an owner'
            USING ERRCODE = '23514', CONSTRAINT = 'workspace_has_owner';
        END IF;
        RETURN NULL;
      END
      $$
    `);
    await run(`
      CREATE CONSTRAINT TRIGGER workspace_has_owner_on_insert
        AFTER INSERT ON nodrail.workspaces
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION nodrail.check_workspace_has_owner()
    `);
    await run(`
      CREATE CONSTRAINT TRIGGER workspace_has_owner_on_change
        AFTER UPDATE OF is_owner ON nodrail.workspace_memberships
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION nodrail.check_workspace_has_owner()
    `);
    await run(`
      CREATE FUNCTION nodrail.check_environment_has_policy() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM nodrail.active_policies p
          WHERE p.workspace_id = NEW.workspace_id AND p.environment_id = NEW.id
        ) THEN
          RAISE EXCEPTION 'environment must have an active policy'
            USING ERRCODE = '23514', CONSTRAINT = 'environment_has_policy';
        END IF;
        RETURN NULL;
      END
      $$
    `);
    await run(`
      CREATE CONSTRAINT TRIGGER environment_has_policy_on_insert
        AFTER INSERT ON nodrail.environments
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION nodrail.check_environment_has_policy()
    `);

    for (const table of tenantTables) {
      await run(`ALTER TABLE nodrail.${table} ENABLE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);
      await run(`
        CREATE POLICY tenant ON nodrail.${table}
          USING (workspace_id = nodrail.current_workspace_id())
          WITH CHECK (workspace_id = nodrail.current_workspace_id())
      `);
    }

    await run("ALTER TABLE nodrail.workspaces ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.workspaces FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY tenant ON nodrail.workspaces
        USING (id = nodrail.current_workspace_id())
        WITH CHECK (id = nodrail.current_workspace_id())
    `);

    // Before a workspace is chosen, a person may list only their own.
    await run(`
      CREATE POLICY own_memberships ON nodrail.workspace_memberships FOR SELECT
        USING (user_id = nodrail.current_user_id())
    `);
    await run(`
      CREATE POLICY own_workspaces ON nodrail.workspaces FOR SELECT
        USING (id IN (
          SELECT m.workspace_id FROM nodrail.workspace_memberships m
          WHERE m.user_id = nodrail.current_user_id() AND m.status = 'active'))
    `);

    await run("ALTER TABLE nodrail.users ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.users FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY visible_users ON nodrail.users FOR SELECT
        USING (
          id = nodrail.current_user_id()
          OR id IN (
            SELECT m.user_id FROM nodrail.workspace_memberships m
            WHERE m.workspace_id = nodrail.current_workspace_id()))
    `);
    await run("ALTER TABLE nodrail.human_sessions ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.human_sessions FORCE ROW LEVEL SECURITY");
    await run(`
      CREATE POLICY own_sessions ON nodrail.human_sessions
        USING (user_id = nodrail.current_user_id())
        WITH CHECK (user_id = nodrail.current_user_id())
    `);

    for (const [table, predicate] of Object.entries(memberScope))
      await run(`
        CREATE POLICY member_scope ON nodrail.${table}
          AS RESTRICTIVE FOR SELECT TO nodrail_member_read
          USING (${predicate})
      `);

    await run("REVOKE ALL ON SCHEMA nodrail FROM PUBLIC");
    await run("REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nodrail FROM PUBLIC");
    for (const role of ["nodrail_app", "nodrail_member_read"]) {
      await run(`GRANT USAGE ON SCHEMA nodrail TO ${role}`);
      await run(
        `GRANT EXECUTE ON FUNCTION nodrail.current_workspace_id(), nodrail.current_user_id(), nodrail.sees_whole_workspace() TO ${role}`,
      );
      await run(`GRANT SELECT ON nodrail.users, nodrail.workspaces TO ${role}`);
      await run(
        `GRANT SELECT ON ${tenantTables.map((table) => `nodrail.${table}`).join(", ")} TO ${role}`,
      );
    }

    // No UPDATE or DELETE on history; narrow column grants everywhere else.
    const writes: [string, string, string?][] = [
      ["workspaces", "INSERT", "name, default_environment_id, archived_at"],
      ["workspace_memberships", "INSERT", "role, is_owner, status, revoked_at"],
      ["workspace_invites", "INSERT", "status, accepted_by, accepted_at"],
      [
        "notification_preferences",
        "INSERT",
        "approval_requested, new_permission, integration_stale, updated_at",
      ],
      ["environments", "INSERT", "name"],
      [
        "agents",
        "INSERT",
        "description, access_status, access_epoch, paused_at, paused_by, archived_at",
      ],
      ["agent_members", "INSERT, DELETE"],
      ["installations", "INSERT", "adapter_version, last_seen_at, archived_at"],
      [
        "installation_credentials",
        "INSERT",
        "revoked_at, revoked_by, last_used_at",
      ],
      [
        "observed_permissions",
        "INSERT",
        "attempt_count, last_outcome, last_action_request_id, last_seen_at, manifest_version",
      ],
      ["action_requests", "INSERT", "attempt_count, last_attempt_at"],
      [
        "approval_requests",
        "INSERT",
        "reason, state, invalidated_reason, decided_by, decided_session_id, decided_at, decided_policy_version_id",
      ],
      ["active_policies", "INSERT", "policy_version_id, activated_at"],
      ["policy_versions", "INSERT"],
      ["policy_rules", "INSERT"],
      ["decision_permits", "INSERT"],
      ["client_reports", "INSERT"],
      ["audit_events", "INSERT"],
    ];
    await run("GRANT SELECT ON nodrail.human_sessions TO nodrail_app");
    await run(
      "GRANT UPDATE (revoked_at) ON nodrail.human_sessions TO nodrail_app",
    );
    await run(
      "GRANT EXECUTE ON FUNCTION nodrail.check_workspace_has_owner(), nodrail.check_environment_has_policy() TO nodrail_app",
    );
    for (const [table, privileges, columns] of writes) {
      await run(`GRANT ${privileges} ON nodrail.${table} TO nodrail_app`);
      if (columns)
        await run(
          `GRANT UPDATE (${columns}) ON nodrail.${table} TO nodrail_app`,
        );
    }
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run(
      "DROP TRIGGER workspace_has_owner_on_change ON nodrail.workspace_memberships",
    );
    await run(
      "DROP TRIGGER workspace_has_owner_on_insert ON nodrail.workspaces",
    );
    await run(
      "DROP TRIGGER environment_has_policy_on_insert ON nodrail.environments",
    );
    for (const table of Object.keys(memberScope))
      await run(`DROP POLICY member_scope ON nodrail.${table}`);
    await run("DROP POLICY own_memberships ON nodrail.workspace_memberships");
    await run("DROP POLICY own_workspaces ON nodrail.workspaces");
    await run("DROP POLICY visible_users ON nodrail.users");
    await run("DROP POLICY own_sessions ON nodrail.human_sessions");
    for (const table of [...tenantTables, "workspaces"])
      await run(`DROP POLICY tenant ON nodrail.${table}`);
    for (const table of [
      ...tenantTables,
      "workspaces",
      "users",
      "human_sessions",
    ]) {
      await run(`ALTER TABLE nodrail.${table} NO FORCE ROW LEVEL SECURITY`);
      await run(`ALTER TABLE nodrail.${table} DISABLE ROW LEVEL SECURITY`);
    }
    await run(
      "REVOKE ALL ON ALL TABLES IN SCHEMA nodrail FROM nodrail_app, nodrail_member_read",
    );
    await run(
      "REVOKE ALL ON SCHEMA nodrail FROM nodrail_app, nodrail_member_read",
    );
    await run("DROP FUNCTION nodrail.check_workspace_has_owner()");
    await run("DROP FUNCTION nodrail.check_environment_has_policy()");
    await run("DROP FUNCTION nodrail.sees_whole_workspace()");
    await run("DROP FUNCTION nodrail.current_user_id()");
    await run("DROP FUNCTION nodrail.current_workspace_id()");
  }
}
