import type { MigrationInterface, QueryRunner } from "typeorm";

export class HostCaller9999880000000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`
      ALTER TABLE nodrail.installations ADD CONSTRAINT "UQ_4be3a2640b6825de8f3fc2b579f"
        UNIQUE (workspace_id, id, environment_id);
      ALTER TABLE nodrail.action_requests DROP CONSTRAINT "FK_b3d008603ed51ef1157e5c13411",
        ADD CONSTRAINT "FK_7d65b552ba045146cad78338e4d" FOREIGN KEY
          (installation_id, workspace_id, environment_id)
          REFERENCES nodrail.installations (id, workspace_id, environment_id) ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_c22b1b64ccae8356ae738971f9d" FOREIGN KEY
          (agent_id, workspace_id) REFERENCES nodrail.agents (id, workspace_id) ON DELETE RESTRICT;
      CREATE FUNCTION nodrail.check_action_caller() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, nodrail AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM nodrail.installations i
          JOIN nodrail.agents a ON a.workspace_id = i.workspace_id AND a.id = NEW.agent_id
          WHERE i.workspace_id = NEW.workspace_id AND i.id = NEW.installation_id
            AND i.environment_id = NEW.environment_id
            AND (i.agent_id = a.id OR (
              to_jsonb(i)->>'enrollment_project_id' IS NOT NULL
              AND to_jsonb(a)->>'managed_project_id' = to_jsonb(i)->>'enrollment_project_id'
              AND a.archived_at IS NULL
              AND (to_jsonb(i)->'enrollment_agent_keys') ? a.external_key
            ))
        ) THEN
          RAISE EXCEPTION 'action caller violates installation foreign key'
            USING ERRCODE = '23503';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER action_caller BEFORE INSERT OR UPDATE OF workspace_id, environment_id,
        installation_id, agent_id ON nodrail.action_requests
        FOR EACH ROW EXECUTE FUNCTION nodrail.check_action_caller();
      ALTER TABLE nodrail.budget_leases ADD COLUMN agent_id uuid;
      ALTER TABLE nodrail.inventory_reports ADD COLUMN last_seen_at timestamptz;
      ALTER TABLE nodrail.reported_events DROP CONSTRAINT reported_events_decision,
        ADD CONSTRAINT reported_events_decision CHECK
          ((kind = 'decision') = (decision IS NOT NULL) AND
            (decision IS NULL OR decision IN ('allow', 'deny', 'would_deny')));
    `);
  }

  async down(db: QueryRunner) {
    await db.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM nodrail.reported_events WHERE decision = 'would_deny')
          OR EXISTS (
            SELECT 1 FROM nodrail.action_requests a JOIN nodrail.installations i
            ON i.workspace_id = a.workspace_id AND i.id = a.installation_id
            WHERE a.agent_id <> i.agent_id
          ) THEN
          RAISE EXCEPTION 'Cannot roll back while host caller or watch records exist';
        END IF;
      END;
      $$;
      ALTER TABLE nodrail.reported_events DROP CONSTRAINT reported_events_decision,
        ADD CONSTRAINT reported_events_decision CHECK
          ((kind = 'decision') = (decision IS NOT NULL) AND
            (decision IS NULL OR decision IN ('allow', 'deny')));
      ALTER TABLE nodrail.inventory_reports DROP COLUMN last_seen_at;
      ALTER TABLE nodrail.budget_leases DROP COLUMN agent_id;
      DROP TRIGGER action_caller ON nodrail.action_requests;
      DROP FUNCTION nodrail.check_action_caller();
      ALTER TABLE nodrail.action_requests DROP CONSTRAINT "FK_c22b1b64ccae8356ae738971f9d",
        DROP CONSTRAINT "FK_7d65b552ba045146cad78338e4d";
      ALTER TABLE nodrail.action_requests ADD CONSTRAINT "FK_b3d008603ed51ef1157e5c13411"
        FOREIGN KEY (installation_id, workspace_id, agent_id, environment_id)
        REFERENCES nodrail.installations (id, workspace_id, agent_id, environment_id) ON DELETE RESTRICT;
      ALTER TABLE nodrail.installations DROP CONSTRAINT "UQ_4be3a2640b6825de8f3fc2b579f";
    `);
  }
}
