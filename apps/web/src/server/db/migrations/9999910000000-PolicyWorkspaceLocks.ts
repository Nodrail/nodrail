import type { MigrationInterface, QueryRunner } from "typeorm";

export class PolicyWorkspaceLocks9999910000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const table = "nodrail.policy_workspace_locks";
    const naming = queryRunner.connection.namingStrategy;
    const version = ["workspace_id", "environment_id", "policy_version_id"];
    const pk = naming.primaryKeyName(table, [...version, "workspace_revision"]);
    const fk = naming.foreignKeyName(table, version);
    await queryRunner.query(`
      CREATE TABLE ${table} (
        workspace_id uuid NOT NULL,
        environment_id uuid NOT NULL,
        policy_version_id uuid NOT NULL,
        workspace_revision text NOT NULL,
        CONSTRAINT "${pk}" PRIMARY KEY (workspace_id, environment_id, policy_version_id, workspace_revision),
        CONSTRAINT "${fk}" FOREIGN KEY (workspace_id, environment_id, policy_version_id)
          REFERENCES nodrail.policy_versions (workspace_id, environment_id, id) ON DELETE RESTRICT,
        CONSTRAINT policy_workspace_locks_digest CHECK (workspace_revision ~ '^[0-9a-f]{64}$')
      );
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant ON ${table} TO nodrail_app, nodrail_member_read
        USING (workspace_id = nodrail.current_workspace_id())
        WITH CHECK (workspace_id = nodrail.current_workspace_id());
      GRANT SELECT, INSERT ON ${table} TO nodrail_app;
      GRANT SELECT ON ${table} TO nodrail_member_read;
    `);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query("DROP TABLE nodrail.policy_workspace_locks");
  }
}
