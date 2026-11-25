import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Nothing waits for a person any more: a rule only allows or denies, and an
 * unmet gate or budget denies with its reason. What only served approvals
 * goes:
 *
 * - the `approval_requests` table, its permit link
 *   (`decision_permits.approval_request_id`) and its contract-event link
 *   (`contract_events.approval_request_id`);
 * - `insight_dismissals`, whose one kind was a repeated approval;
 * - the `approver` role and the `decide` token scope (approvers become
 *   viewers; tokens keep their other scopes), and the `holds:write` scope
 *   of host credentials: a hold that waited for a person never comes;
 * - the approval and new-permission notifications, and their preferences;
 * - `require_approval` as a rule's, gate's, budget's or local report's
 *   decision, and the `approval_pending` and `unknown_permission_blocked`
 *   evaluations of an action; the `needs_approval` observed outcome; the
 *   `approval_form` contract surface.
 *
 * Existing rows are moved to what they mean now: a review rule, gate or
 * budget denies; an action that waited for a person is denied, unless a
 * permit was issued for it, which is then read as allowed; an observed
 * permission that needed approval was denied. Approval-form contracts and
 * queued approval emails are deleted. A version published from a file keeps
 * that file's text and digest as history; publishing again needs the new
 * syntax.
 *
 * Down restores the structure only, and loses data: the approval history,
 * dismissals, notification preferences and approver roles don't come back.
 *
 * Row security: data is moved as the owner. Tables whose row security is
 * forced have it lifted for their statements only, inside this transaction,
 * and forced again; `workspace_invites` and `personal_access_tokens` aren't
 * forced and stay that way, as does `installation_credentials`, whose
 * credential lookup depends on it.
 */

const T = (table: string) => `"nodrail"."${table}"`;

/** Each changed check: its table, what it was, and what it is now. */
const CHECKS: Record<string, { table: string; before: string; after: string }> =
  {
    memberships_role: {
      table: "workspace_memberships",
      before: `"role" IN ('admin', 'approver', 'policy_manager', 'viewer')`,
      after: `"role" IN ('admin', 'policy_manager', 'viewer')`,
    },
    invites_role: {
      table: "workspace_invites",
      before: `"proposed_role" IN ('approver', 'policy_manager', 'viewer')`,
      after: `"proposed_role" IN ('policy_manager', 'viewer')`,
    },
    personal_access_tokens_scopes: {
      table: "personal_access_tokens",
      before: `"scopes" <@ ARRAY['read', 'decide', 'rules:write', 'inventory:write']::text[] AND ('read' = ANY ("scopes") OR "scopes" = ARRAY['inventory:write']::text[])`,
      after: `"scopes" <@ ARRAY['read', 'rules:write', 'inventory:write']::text[] AND ('read' = ANY ("scopes") OR "scopes" = ARRAY['inventory:write']::text[])`,
    },
    policy_rules_effect: {
      table: "policy_rules",
      before: `"effect" IN ('deny', 'require_approval', 'allow')`,
      after: `"effect" IN ('deny', 'allow')`,
    },
    action_requests_evaluation: {
      table: "action_requests",
      before: `"initial_evaluation" IN ('ready', 'approval_pending', 'unknown_permission_blocked', 'denied')`,
      after: `"initial_evaluation" IN ('ready', 'denied')`,
    },
    action_requests_host: {
      table: "action_requests",
      before: `("decided_by" = 'server' AND "policy_digest" IS NULL AND "host_rule_id" IS NULL AND "host_rule_name" IS NULL AND "host_reason" IS NULL AND "host_decided_at" IS NULL AND "body_digest" IS NULL) OR ("decided_by" = 'host' AND "host_decided_at" IS NOT NULL AND "body_digest" ~ '^sha256:[0-9a-f]{64}$' AND "initial_evaluation" IN ('ready', 'approval_pending', 'denied') AND "run_hold" IS NULL)`,
      after: `("decided_by" = 'server' AND "policy_digest" IS NULL AND "host_rule_id" IS NULL AND "host_rule_name" IS NULL AND "host_reason" IS NULL AND "host_decided_at" IS NULL AND "body_digest" IS NULL) OR ("decided_by" = 'host' AND "host_decided_at" IS NOT NULL AND "body_digest" ~ '^sha256:[0-9a-f]{64}$' AND "run_hold" IS NULL)`,
    },
    observed_outcome: {
      table: "observed_permissions",
      before: `"last_outcome" IN ('allowed_by_rule', 'denied_by_rule', 'needs_approval', 'unknown_blocked', 'observed_only')`,
      after: `"last_outcome" IN ('allowed_by_rule', 'denied_by_rule', 'unknown_blocked', 'observed_only')`,
    },
    notification_kind: {
      table: "notification_outbox",
      before: `"kind" IN ('approval_requested', 'new_permission', 'integration_stale', 'usage_alert')`,
      after: `"kind" IN ('integration_stale', 'usage_alert')`,
    },
    reported_events_decision: {
      table: "reported_events",
      before: `("kind" = 'decision') = ("decision" IS NOT NULL) AND ("decision" IS NULL OR "decision" IN ('allow', 'deny', 'require_approval'))`,
      after: `("kind" = 'decision') = ("decision" IS NOT NULL) AND ("decision" IS NULL OR "decision" IN ('allow', 'deny'))`,
    },
    ...Object.fromEntries(
      [
        "contract_revisions",
        "contract_projections",
        "contract_bindings",
        "contract_events",
      ].map((table) => [
        `${table}_surface`,
        {
          table,
          before: `"surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'approval_form', 'inventory_metadata')`,
          after: `"surface" IN ('receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'inventory_metadata')`,
        },
      ]),
    ),
  };

const NO_REPORTER = `"user_id" IS NULL AND "trace_id" IS NULL AND "span_id" IS NULL AND "machine" IS NULL AND "project_id" IS NULL AND "project" IS NULL AND "host" IS NULL AND "run" IS NULL`;

/** Where a contract event came from; an approval link is one fewer column to keep empty. */
const EVENT_SOURCE = {
  before: `("authority" = 'reported' AND "verifier_id" IS NULL AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN ('agent-reported', 'runtime-observed') AND "subject_source" IS DISTINCT FROM 'externally-verified') OR ("authority" = 'authoritative' AND "verifier_id" IS NULL AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "validated_by" IS DISTINCT FROM 'producer') OR ("authority" = 'authoritative' AND "verifier_id" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "run_id" IS NULL AND "action_digest" IS NULL AND "approval_request_id" IS NULL AND "surface" = 'evidence' AND "evidence" IS NOT NULL AND "producer_class" = 'externally-verified' AND "subject_source" = 'externally-verified' AND "validated_by" = 'server' AND "provenance" IS NOT NULL AND "body_digest" IS NOT NULL)`,
  after: `("authority" = 'reported' AND "verifier_id" IS NULL AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN ('agent-reported', 'runtime-observed') AND "subject_source" IS DISTINCT FROM 'externally-verified') OR ("authority" = 'authoritative' AND "verifier_id" IS NULL AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "validated_by" IS DISTINCT FROM 'producer') OR ("authority" = 'authoritative' AND "verifier_id" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "run_id" IS NULL AND "action_digest" IS NULL AND "surface" = 'evidence' AND "evidence" IS NOT NULL AND "producer_class" = 'externally-verified' AND "subject_source" = 'externally-verified' AND "validated_by" = 'server' AND "provenance" IS NOT NULL AND "body_digest" IS NOT NULL)`,
};

/** Tables whose row security is forced, so the owner sees no row without lifting it. */
const FORCED = [
  "workspace_memberships",
  "policy_versions",
  "policy_rules",
  "action_requests",
  "observed_permissions",
  "notification_outbox",
  "reported_events",
  "contract_events",
  "contract_bindings",
  "contract_projections",
  "contract_revisions",
];

/** The SQL that moves existing rows to what they mean now. */
const MOVES = [
  `UPDATE ${T("workspace_memberships")} SET "role" = 'viewer' WHERE "role" = 'approver'`,
  `UPDATE ${T("workspace_invites")} SET "proposed_role" = 'viewer' WHERE "proposed_role" = 'approver'`,
  `UPDATE ${T("personal_access_tokens")} SET "scopes" = array_remove("scopes", 'decide') WHERE 'decide' = ANY ("scopes")`,
  `UPDATE ${T("installation_credentials")} SET "scopes" = array_remove("scopes", 'holds:write') WHERE 'holds:write' = ANY ("scopes")`,
  `UPDATE ${T("policy_rules")} SET "effect" = 'deny' WHERE "effect" = 'require_approval'`,
  // The engine reads a version's gates and budgets from here: what held for
  // review now denies. Its file text stays as it was published.
  `UPDATE ${T("policy_versions")} SET "run_policy" = replace("run_policy"::text, '"effect": "require_approval"', '"effect": "deny"')::jsonb WHERE "run_policy"::text LIKE '%"require_approval"%'`,
  `UPDATE ${T("action_requests")} ar SET "initial_evaluation" = CASE WHEN EXISTS (SELECT 1 FROM ${T("decision_permits")} p WHERE p.workspace_id = ar.workspace_id AND p.action_request_id = ar.id) THEN 'ready' ELSE 'denied' END WHERE "initial_evaluation" IN ('approval_pending', 'unknown_permission_blocked')`,
  `UPDATE ${T("observed_permissions")} SET "last_outcome" = 'denied_by_rule' WHERE "last_outcome" = 'needs_approval'`,
  `DELETE FROM ${T("notification_outbox")} WHERE "kind" IN ('approval_requested', 'new_permission')`,
  `UPDATE ${T("reported_events")} SET "decision" = 'deny' WHERE "decision" = 'require_approval'`,
  ...[
    "contract_events",
    "contract_bindings",
    "contract_projections",
    "contract_revisions",
  ].map((table) => `DELETE FROM ${T(table)} WHERE "surface" = 'approval_form'`),
];

/** The approval table as it last stood, for down. */
const APPROVAL_TABLE = `CREATE TABLE ${T("approval_requests")} ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "reason" text NOT NULL, "state" text NOT NULL DEFAULT 'pending', "invalidated_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "decided_by" uuid, "decided_session_id" uuid, "decided_at" TIMESTAMP WITH TIME ZONE, "decided_policy_version_id" uuid, "decided_token_id" uuid, CONSTRAINT "UQ_ca643987f269001326365d03859" UNIQUE ("workspace_id", "id", "action_request_id"), CONSTRAINT "UQ_b065d9847ae24b15d2a9b76fed6" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_ee8048bd1bcc2b11d0cf257351c" UNIQUE ("workspace_id", "action_request_id"), CONSTRAINT "approvals_decided" CHECK ("state" NOT IN ('approved_once', 'denied') OR ("decided_by" IS NOT NULL AND "decided_at" IS NOT NULL AND num_nonnulls("decided_session_id", "decided_token_id") = 1)), CONSTRAINT "approvals_pending" CHECK ("state" <> 'pending' OR "decided_at" IS NULL), CONSTRAINT "approvals_invalidated" CHECK (("invalidated_reason" IS NOT NULL) = ("state" = 'invalidated')), CONSTRAINT "approvals_expiry" CHECK ("expires_at" > "created_at"), CONSTRAINT "approvals_invalidated_reason" CHECK ("invalidated_reason" IN ('policy_changed', 'agent_paused', 'credential_revoked', 'approver_access_removed', 'withdrawn')), CONSTRAINT "approvals_state" CHECK ("state" IN ('pending', 'approved_once', 'denied', 'expired', 'invalidated')), CONSTRAINT "approvals_reason" CHECK ("reason" IN ('new_permission', 'rule_requires_review')), CONSTRAINT "PK_484806bb8ff331b851fc75973c0" PRIMARY KEY ("id"))`;

const APPROVAL_STRUCTURE = [
  `CREATE INDEX "approval_requests_decider" ON ${T("approval_requests")} ("workspace_id", "decided_by") WHERE "state" = 'approved_once'`,
  `CREATE INDEX "approval_requests_queue" ON ${T("approval_requests")} ("workspace_id", "state", "created_at", "id")`,
  `ALTER TABLE ${T("approval_requests")} ADD CONSTRAINT "FK_ee8048bd1bcc2b11d0cf257351c" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES ${T("action_requests")}("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("approval_requests")} ADD CONSTRAINT "FK_46bf120d1bb4b3beeb29541756e" FOREIGN KEY ("workspace_id", "decided_by") REFERENCES ${T("workspace_memberships")}("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("approval_requests")} ADD CONSTRAINT "FK_7bf6b0ddc4b615f248bee686667" FOREIGN KEY ("decided_session_id", "decided_by") REFERENCES ${T("human_sessions")}("id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("approval_requests")} ADD CONSTRAINT "FK_65ba7ebecd6d2437372d7db4f12" FOREIGN KEY ("decided_policy_version_id", "workspace_id") REFERENCES ${T("policy_versions")}("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("approval_requests")} ADD CONSTRAINT "FK_98811be2617992f8b23029e57a8" FOREIGN KEY ("decided_token_id", "workspace_id", "decided_by") REFERENCES ${T("personal_access_tokens")}("id","workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  "ALTER TABLE nodrail.approval_requests ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE nodrail.approval_requests FORCE ROW LEVEL SECURITY",
  `CREATE POLICY tenant ON nodrail.approval_requests
     USING (workspace_id = nodrail.current_workspace_id())
     WITH CHECK (workspace_id = nodrail.current_workspace_id())`,
  `CREATE POLICY member_scope ON nodrail.approval_requests
     AS RESTRICTIVE FOR SELECT TO nodrail_member_read
     USING (action_request_id IN (SELECT id FROM nodrail.action_requests))`,
  `CREATE POLICY metrics_read ON nodrail.approval_requests
     FOR SELECT TO nodrail_metrics USING (true)`,
  "GRANT SELECT ON nodrail.approval_requests TO nodrail_app, nodrail_member_read",
  "GRANT INSERT ON nodrail.approval_requests TO nodrail_app",
  "GRANT UPDATE (reason, state, invalidated_reason, decided_by, decided_session_id, decided_at, decided_policy_version_id, decided_token_id) ON nodrail.approval_requests TO nodrail_app",
  "GRANT SELECT (workspace_id, action_request_id, state, created_at, decided_at, expires_at) ON nodrail.approval_requests TO nodrail_metrics",
  `ALTER TABLE ${T("decision_permits")} ADD "approval_request_id" uuid`,
  `CREATE UNIQUE INDEX "decision_permits_one_per_approval" ON ${T("decision_permits")} ("workspace_id", "approval_request_id") WHERE "approval_request_id" IS NOT NULL`,
  `ALTER TABLE ${T("decision_permits")} ADD CONSTRAINT "FK_a620d047b5a92a4b441c18c97c4" FOREIGN KEY ("approval_request_id", "workspace_id", "action_request_id") REFERENCES ${T("approval_requests")}("id","workspace_id","action_request_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("contract_events")} ADD "approval_request_id" uuid`,
  `ALTER TABLE ${T("contract_events")} ADD CONSTRAINT "FK_3444a1311bcd7a8c1d3d6731776" FOREIGN KEY ("approval_request_id", "workspace_id") REFERENCES ${T("approval_requests")}("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
];

const DISMISSALS = [
  `CREATE TABLE ${T("insight_dismissals")} ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "kind" text NOT NULL, "fingerprint" text NOT NULL, "dismissed_by" uuid NOT NULL, "dismissed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_ad998f4393ba2c1b05b021cbae5" UNIQUE ("workspace_id", "environment_id", "kind", "fingerprint"), CONSTRAINT "insight_dismissals_fingerprint" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'), CONSTRAINT "insight_dismissals_kind" CHECK ("kind" IN ('repeated_approval')), CONSTRAINT "PK_10e9044eee71fc4e70b16c8418f" PRIMARY KEY ("id"))`,
  `ALTER TABLE ${T("insight_dismissals")} ADD CONSTRAINT "FK_11583996d9636aeb32744b94629" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES ${T("environments")}("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  `ALTER TABLE ${T("insight_dismissals")} ADD CONSTRAINT "FK_c178a8bbafce29471b91278e149" FOREIGN KEY ("workspace_id", "dismissed_by") REFERENCES ${T("workspace_memberships")}("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
  "ALTER TABLE nodrail.insight_dismissals ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE nodrail.insight_dismissals FORCE ROW LEVEL SECURITY",
  `CREATE POLICY tenant ON nodrail.insight_dismissals
     USING (workspace_id = nodrail.current_workspace_id())
     WITH CHECK (workspace_id = nodrail.current_workspace_id())`,
  "GRANT SELECT ON nodrail.insight_dismissals TO nodrail_member_read",
  "GRANT SELECT, INSERT ON nodrail.insight_dismissals TO nodrail_app",
];

export class NoApprovals9999800000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");

    // Each table's rows first, while the old checks still hold them.
    for (const table of FORCED)
      await run(`ALTER TABLE nodrail.${table} NO FORCE ROW LEVEL SECURITY`);
    for (const sql of MOVES) await run(sql);
    for (const table of FORCED)
      await run(`ALTER TABLE nodrail.${table} FORCE ROW LEVEL SECURITY`);

    await run(
      `ALTER TABLE ${T("contract_events")} DROP CONSTRAINT "contract_events_source"`,
    );
    await run(
      `ALTER TABLE ${T("decision_permits")} DROP CONSTRAINT "FK_a620d047b5a92a4b441c18c97c4"`,
    );
    await run(
      `ALTER TABLE ${T("contract_events")} DROP CONSTRAINT "FK_3444a1311bcd7a8c1d3d6731776"`,
    );
    await run(`DROP INDEX "nodrail"."decision_permits_one_per_approval"`);
    await run(
      `ALTER TABLE ${T("decision_permits")} DROP COLUMN "approval_request_id"`,
    );
    await run(
      `ALTER TABLE ${T("contract_events")} DROP COLUMN "approval_request_id"`,
    );
    await run(
      `ALTER TABLE ${T("contract_events")} ADD CONSTRAINT "contract_events_source" CHECK (${EVENT_SOURCE.after})`,
    );
    // Their policies, grants, indexes and keys go with them.
    await run(`DROP TABLE ${T("approval_requests")}`);
    await run(`DROP TABLE ${T("insight_dismissals")}`);
    await run(
      `ALTER TABLE ${T("notification_preferences")} DROP COLUMN "approval_requested"`,
    );
    await run(
      `ALTER TABLE ${T("notification_preferences")} DROP COLUMN "new_permission"`,
    );

    for (const [name, { table, after }] of Object.entries(CHECKS)) {
      await run(`ALTER TABLE ${T(table)} DROP CONSTRAINT "${name}"`);
      await run(
        `ALTER TABLE ${T(table)} ADD CONSTRAINT "${name}" CHECK (${after}) NOT VALID`,
      );
      await run(`ALTER TABLE ${T(table)} VALIDATE CONSTRAINT "${name}"`);
    }
  }

  async down(queryRunner: QueryRunner) {
    const run = (sql: string) => queryRunner.query(sql);
    await run("SET LOCAL lock_timeout = '5s'");
    for (const [name, { table, before }] of Object.entries(CHECKS)) {
      await run(`ALTER TABLE ${T(table)} DROP CONSTRAINT "${name}"`);
      await run(
        `ALTER TABLE ${T(table)} ADD CONSTRAINT "${name}" CHECK (${before})`,
      );
    }
    for (const column of ["approval_requested", "new_permission"]) {
      await run(
        `ALTER TABLE ${T("notification_preferences")} ADD "${column}" boolean NOT NULL DEFAULT true`,
      );
      await run(
        `GRANT UPDATE (${column}) ON nodrail.notification_preferences TO nodrail_app`,
      );
    }
    for (const sql of DISMISSALS) await run(sql);
    await run(APPROVAL_TABLE);
    for (const sql of APPROVAL_STRUCTURE) await run(sql);
    await run(
      `ALTER TABLE ${T("contract_events")} DROP CONSTRAINT "contract_events_source"`,
    );
    await run(
      `ALTER TABLE ${T("contract_events")} ADD CONSTRAINT "contract_events_source" CHECK (${EVENT_SOURCE.before})`,
    );
    // Host credentials with the data plane's scopes get holds back.
    await run(
      `UPDATE ${T("installation_credentials")} SET "scopes" = ARRAY(SELECT DISTINCT unnest("scopes" || ARRAY['holds:write']::text[]) ORDER BY 1) WHERE 'decisions:write' = ANY ("scopes")`,
    );
  }
}
