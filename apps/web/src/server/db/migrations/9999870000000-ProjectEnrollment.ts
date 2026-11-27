import type { MigrationInterface, QueryRunner } from "typeorm";

export class ProjectEnrollment9999870000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const naming = queryRunner.connection.namingStrategy;
    const pk = naming.primaryKeyName("nodrail.cli_login_requests", [
      "challenge",
    ]);
    const fk = naming.foreignKeyName("nodrail.cli_login_requests", ["user_id"]);
    const projectPk = naming.primaryKeyName("nodrail.enrolled_projects", [
      "workspace_id",
      "project_id",
    ]);
    const projectFk = naming.foreignKeyName("nodrail.enrolled_projects", [
      "workspace_id",
    ]);
    await queryRunner.query(`
      CREATE TABLE nodrail.enrolled_projects (
        workspace_id uuid CONSTRAINT "${projectFk}" REFERENCES nodrail.workspaces(id) ON DELETE RESTRICT,
        project_id uuid,
        owner_id uuid NOT NULL,
        apply_user_ids uuid[] NOT NULL DEFAULT '{}',
        CONSTRAINT "${projectPk}" PRIMARY KEY (workspace_id, project_id)
      );
      ALTER TABLE nodrail.enrolled_projects ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.enrolled_projects FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON nodrail.enrolled_projects TO nodrail_app
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id());
      GRANT SELECT, INSERT ON nodrail.enrolled_projects TO nodrail_app;
      GRANT UPDATE (apply_user_ids) ON nodrail.enrolled_projects TO nodrail_app;

      ALTER TABLE nodrail.policy_versions ADD COLUMN managed_agent_keys text[];
      ALTER TABLE nodrail.agents ADD COLUMN managed_project_id uuid;
      GRANT UPDATE (managed_project_id) ON nodrail.agents TO nodrail_app;
      ALTER TABLE nodrail.installations
        ADD COLUMN enrollment_project_id uuid,
        ADD COLUMN enrollment_machine_id uuid,
        ADD COLUMN enrollment_owner_id uuid,
        ADD COLUMN enrollment_agent_keys text[],
        ADD COLUMN enrollment_disabled_at timestamptz;
      CREATE UNIQUE INDEX installations_machine_project
        ON nodrail.installations (workspace_id, environment_id, enrollment_project_id, enrollment_machine_id)
        WHERE enrollment_project_id IS NOT NULL;
      GRANT UPDATE (scopes) ON nodrail.installation_credentials TO nodrail_app;
      GRANT UPDATE (enrollment_agent_keys, enrollment_disabled_at) ON nodrail.installations TO nodrail_app;
      CREATE TABLE nodrail.cli_login_requests (
        challenge text CONSTRAINT "${pk}" PRIMARY KEY,
        origin text NOT NULL,
        expires_at timestamptz NOT NULL,
        user_id uuid CONSTRAINT "${fk}" REFERENCES nodrail.users(id) ON DELETE RESTRICT
      );
      CREATE INDEX cli_login_requests_expiry ON nodrail.cli_login_requests (expires_at);
      ALTER TABLE nodrail.cli_login_requests ENABLE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.cli_login_requests FORCE ROW LEVEL SECURITY;
      CREATE POLICY auth_cli_login ON nodrail.cli_login_requests TO nodrail_auth
        USING (true) WITH CHECK (true);
      GRANT SELECT, INSERT, DELETE ON nodrail.cli_login_requests TO nodrail_auth;
      GRANT UPDATE (user_id) ON nodrail.cli_login_requests TO nodrail_auth;
    `);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`
      DROP TABLE nodrail.cli_login_requests;
      DROP TABLE nodrail.enrolled_projects;
      REVOKE UPDATE (scopes) ON nodrail.installation_credentials FROM nodrail_app;
      DROP INDEX nodrail.installations_machine_project;
      ALTER TABLE nodrail.installations
        DROP COLUMN enrollment_project_id,
        DROP COLUMN enrollment_machine_id,
        DROP COLUMN enrollment_owner_id,
        DROP COLUMN enrollment_agent_keys,
        DROP COLUMN enrollment_disabled_at;
      ALTER TABLE nodrail.agents DROP COLUMN managed_project_id;
      ALTER TABLE nodrail.policy_versions DROP COLUMN managed_agent_keys;
    `);
  }
}
