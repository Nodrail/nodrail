import type { MigrationInterface, QueryRunner } from "typeorm";

/** Pilot aggregates exclude report-only rows using the access epoch. */
export class DecisionMetricsAccessEpoch9999920000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    // The earlier recorder explicitly backdated only historical audit rows.
    // Live audit timestamps are generated after the action row is inserted.
    await queryRunner.query(`
      ALTER TABLE nodrail.action_requests NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.audit_events NO FORCE ROW LEVEL SECURITY;
      WITH historical AS (
        UPDATE nodrail.action_requests ar SET access_epoch = 0
        FROM nodrail.audit_events e
        WHERE e.workspace_id = ar.workspace_id AND e.action_request_id = ar.id
          AND e.event_type = 'authorization.host_decided' AND ar.decided_by = 'host'
          AND ar.run_id IS NULL AND e.occurred_at = ar.host_decided_at
          AND e.occurred_at < ar.created_at
        RETURNING e.id
      )
      UPDATE nodrail.audit_events
        SET event_type = 'authorization.host_reported_late',
            decision_code = 'host_reported_late'
        WHERE id IN (SELECT id FROM historical);
      ALTER TABLE nodrail.audit_events FORCE ROW LEVEL SECURITY;
      ALTER TABLE nodrail.action_requests FORCE ROW LEVEL SECURITY;
      GRANT SELECT (access_epoch) ON nodrail.action_requests TO nodrail_metrics;
    `);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      "REVOKE SELECT (access_epoch) ON nodrail.action_requests FROM nodrail_metrics",
    );
  }
}
