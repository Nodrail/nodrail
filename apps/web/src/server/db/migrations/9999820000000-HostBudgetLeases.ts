import type { MigrationInterface, QueryRunner } from "typeorm";

export class HostBudgetLeases9999820000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(`CREATE TABLE nodrail.budget_leases (
      id uuid NOT NULL DEFAULT gen_random_uuid(),
      workspace_id uuid NOT NULL, installation_id uuid NOT NULL,
      call_key text NOT NULL, body_digest text NOT NULL, policy_digest text NOT NULL, claim_id uuid, response jsonb NOT NULL DEFAULT '{}',
      CONSTRAINT "PK_83a0ceb5bab5c401b3a3a6e8739" PRIMARY KEY (id),
      CONSTRAINT budget_leases_key UNIQUE (workspace_id, installation_id, call_key),
      CONSTRAINT budget_leases_workspace_id UNIQUE (workspace_id, id),
      CONSTRAINT "FK_300083f250892e10da4bb169100" FOREIGN KEY (installation_id, workspace_id)
        REFERENCES nodrail.installations (id, workspace_id) ON DELETE RESTRICT
    )`);
    await run("ALTER TABLE nodrail.budget_leases ENABLE ROW LEVEL SECURITY");
    await run("ALTER TABLE nodrail.budget_leases FORCE ROW LEVEL SECURITY");
    await run(`CREATE POLICY tenant ON nodrail.budget_leases
      USING (workspace_id = nodrail.current_workspace_id())
      WITH CHECK (workspace_id = nodrail.current_workspace_id())`);
    await run(
      "GRANT SELECT, INSERT, UPDATE (response, claim_id) ON nodrail.budget_leases TO nodrail_app",
    );
    await run(`ALTER TABLE nodrail.budget_reservations
      ALTER COLUMN permit_id DROP NOT NULL,
      ALTER COLUMN action_request_id DROP NOT NULL,
      ADD lease_id uuid,
      ADD started_at timestamptz,
      ADD CONSTRAINT "FK_4f4be075a108e41f99c9307247d" FOREIGN KEY (lease_id, workspace_id)
        REFERENCES nodrail.budget_leases (id, workspace_id) ON DELETE RESTRICT,
      ADD CONSTRAINT budget_reservations_lease_once UNIQUE (workspace_id, lease_id, budget_key),
      ADD CONSTRAINT budget_reservations_origin CHECK
        ((lease_id IS NULL AND permit_id IS NOT NULL AND action_request_id IS NOT NULL)
          OR (lease_id IS NOT NULL AND permit_id IS NULL))`);
    await run(
      "GRANT UPDATE (action_request_id, started_at) ON nodrail.budget_reservations TO nodrail_app",
    );
    await run(`ALTER POLICY member_scope ON nodrail.budget_reservations
      USING (action_request_id IN (SELECT id FROM nodrail.action_requests)
        OR (action_request_id IS NULL AND (SELECT nodrail.sees_whole_workspace())))`);
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    await run(`ALTER POLICY member_scope ON nodrail.budget_reservations
      USING (action_request_id IN (SELECT id FROM nodrail.action_requests))`);
    await run(
      "REVOKE UPDATE (action_request_id, started_at) ON nodrail.budget_reservations FROM nodrail_app",
    );
    // The migration owner needs to remove host leases across workspaces.
    await run(
      "ALTER TABLE nodrail.budget_reservations NO FORCE ROW LEVEL SECURITY",
    );
    await run("ALTER TABLE nodrail.budget_windows NO FORCE ROW LEVEL SECURITY");
    await run(`DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM nodrail.budget_reservations r
          JOIN nodrail.budget_windows w
            ON w.workspace_id = r.workspace_id AND w.id = r.window_id
          WHERE r.lease_id IS NOT NULL AND (
            r.state = 'unknown'
            OR (r.state = 'reserved' AND
                (r.started_at IS NOT NULL OR r.unknown_after > clock_timestamp()))
            OR (r.state = 'consumed' AND
                (w.ends_at IS NULL OR w.ends_at > clock_timestamp()))
          )
        ) THEN
          RAISE EXCEPTION 'Cannot roll back shared budgets while host accounting is still needed';
        END IF;
      END $$`);
    await run(
      "DELETE FROM nodrail.budget_reservations WHERE lease_id IS NOT NULL",
    );
    await run(`ALTER TABLE nodrail.budget_reservations
      DROP CONSTRAINT budget_reservations_origin,
      DROP COLUMN lease_id,
      DROP COLUMN started_at,
      ALTER COLUMN action_request_id SET NOT NULL,
      ALTER COLUMN permit_id SET NOT NULL`);
    await run(
      "ALTER TABLE nodrail.budget_reservations FORCE ROW LEVEL SECURITY",
    );
    await run("ALTER TABLE nodrail.budget_windows FORCE ROW LEVEL SECURITY");
    await run("DROP TABLE nodrail.budget_leases");
  }
}
