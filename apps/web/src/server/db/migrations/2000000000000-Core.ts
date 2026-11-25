import { MigrationInterface, QueryRunner } from "typeorm";

export class Core2000000000000 implements MigrationInterface {
  name = "Core2000000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nodrail"."users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "display_name" text NOT NULL, "verified_email" text, "status" text NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "users_status" CHECK ("status" IN ('active', 'suspended')), CONSTRAINT "users_email" CHECK (length("verified_email") <= 254), CONSTRAINT "users_display_name" CHECK (length("display_name") BETWEEN 1 AND 120), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."external_auth_accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "provider" text NOT NULL, "issuer" text NOT NULL, "subject" text NOT NULL, CONSTRAINT "UQ_734bbc90f1ea6f5169ffebc582f" UNIQUE ("id", "user_id"), CONSTRAINT "UQ_b4fe08e189f887456370bc38430" UNIQUE ("provider", "issuer", "subject"), CONSTRAINT "PK_0ed5570011d49697d4f2518bd3f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."human_sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "external_auth_account_id" uuid NOT NULL, "provider_session_id" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_55ddd889190885128da9e7eb5f3" UNIQUE ("id", "user_id"), CONSTRAINT "UQ_54409d5d3eaba69ee99cab8238a" UNIQUE ("external_auth_account_id", "provider_session_id"), CONSTRAINT "human_sessions_expiry" CHECK ("expires_at" > "created_at"), CONSTRAINT "PK_87dafc676d98c011453e78f5015" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."workspaces" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" text NOT NULL, "slug" text NOT NULL, "default_environment_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_b8e9fe62e93d60089dfc4f175f3" UNIQUE ("slug"), CONSTRAINT "workspaces_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,62}$'), CONSTRAINT "workspaces_name" CHECK (length("name") BETWEEN 1 AND 120), CONSTRAINT "PK_098656ae401f3e1a4586f47fd8e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."workspace_memberships" ("workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "role" text NOT NULL, "is_owner" boolean NOT NULL DEFAULT false, "status" text NOT NULL DEFAULT 'active', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "memberships_owner_active_admin" CHECK (NOT "is_owner" OR ("role" = 'admin' AND "status" = 'active')), CONSTRAINT "memberships_revoked" CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL)), CONSTRAINT "memberships_status" CHECK ("status" IN ('active', 'revoked')), CONSTRAINT "memberships_role" CHECK ("role" IN ('admin', 'approver', 'policy_manager', 'viewer')), CONSTRAINT "PK_4689405e98986489166f648d1f7" PRIMARY KEY ("workspace_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "workspace_memberships_one_owner" ON "nodrail"."workspace_memberships"  ("workspace_id") WHERE "is_owner" = true`,
    );
    await queryRunner.query(
      `CREATE INDEX "workspace_memberships_user" ON "nodrail"."workspace_memberships"  ("user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."workspace_invites" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "normalized_email" text NOT NULL, "proposed_role" text NOT NULL, "token_digest" text NOT NULL, "inviter_user_id" uuid NOT NULL, "status" text NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "accepted_by" uuid, "accepted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_eca21ac79552530ed0940a432be" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_fd7296250e4ef323b077458470d" UNIQUE ("token_digest"), CONSTRAINT "invites_accepted" CHECK (("status" = 'accepted') = ("accepted_at" IS NOT NULL)), CONSTRAINT "invites_expiry" CHECK ("expires_at" > "created_at"), CONSTRAINT "invites_status" CHECK ("status" IN ('pending', 'accepted', 'revoked')), CONSTRAINT "invites_role" CHECK ("proposed_role" IN ('approver', 'policy_manager', 'viewer')), CONSTRAINT "invites_email" CHECK ("normalized_email" = lower("normalized_email") AND length("normalized_email") <= 254), CONSTRAINT "PK_43f7a0e0b0549fe2581e9cb57bc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "workspace_invites_one_pending" ON "nodrail"."workspace_invites"  ("workspace_id", "normalized_email") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."notification_preferences" ("workspace_id" uuid NOT NULL, "user_id" uuid NOT NULL, "approval_requested" boolean NOT NULL DEFAULT true, "new_permission" boolean NOT NULL DEFAULT true, "integration_stale" boolean NOT NULL DEFAULT true, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2b52260d86edb37e9900582de51" PRIMARY KEY ("workspace_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."environments" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "slug" text NOT NULL, "name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_1082822b567079b8d59cea93782" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_8a9cd1e0f5707f5fd27377c5560" UNIQUE ("workspace_id", "slug"), CONSTRAINT "environments_name" CHECK (length("name") BETWEEN 1 AND 80), CONSTRAINT "environments_slug" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{0,62}$'), CONSTRAINT "PK_ec32d12469ec3c2f2f20c4f5e71" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."policy_versions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "revision" integer NOT NULL, "schema_version" integer NOT NULL DEFAULT '1', "published_by" uuid NOT NULL, "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_83c405873eccd35665fafcb29d8" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_b49d6458761c1176e1fcaaaf4c8" UNIQUE ("workspace_id", "environment_id", "id"), CONSTRAINT "UQ_917d0fa63a8db81b13a6f530580" UNIQUE ("workspace_id", "environment_id", "revision"), CONSTRAINT "policy_versions_revision" CHECK ("revision" > 0), CONSTRAINT "PK_125d2970fc66a316f84af16812e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."active_policies" ("workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "policy_version_id" uuid NOT NULL, "activated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "PK_d5a01db60eefabe6a2ff4ad5d6a" PRIMARY KEY ("workspace_id", "environment_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."agents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "external_key" text NOT NULL, "description" text, "access_status" text NOT NULL DEFAULT 'active', "access_epoch" integer NOT NULL DEFAULT '1', "paused_at" TIMESTAMP WITH TIME ZONE, "paused_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e47a596dc902072162d072002c7" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_b8b5b48926ae8f23b45929fffbf" UNIQUE ("workspace_id", "external_key"), CONSTRAINT "agents_paused" CHECK (("access_status" = 'paused') = ("paused_at" IS NOT NULL)), CONSTRAINT "agents_access_epoch" CHECK ("access_epoch" > 0), CONSTRAINT "agents_access_status" CHECK ("access_status" IN ('active', 'paused')), CONSTRAINT "agents_description" CHECK (length("description") <= 200), CONSTRAINT "agents_external_key" CHECK ("external_key" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'), CONSTRAINT "PK_9c653f28ae19c5884d5baf6a1d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "agents_list" ON "nodrail"."agents"  ("workspace_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."agent_members" ("workspace_id" uuid NOT NULL, "agent_id" uuid NOT NULL, "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f897486f84ec4f46bd2e6072220" PRIMARY KEY ("workspace_id", "agent_id", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "agent_members_user" ON "nodrail"."agent_members"  ("workspace_id", "user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."installations" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "agent_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "name" text NOT NULL, "adapter_key" text NOT NULL, "adapter_version" text, "compatibility" text NOT NULL DEFAULT 'unverified', "last_seen_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "archived_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_203ccfa0bd812d4583e84b0f964" UNIQUE ("workspace_id", "id", "agent_id", "environment_id"), CONSTRAINT "UQ_97bddf3b49d1eb1f849b18aab8a" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_1ceeb26faa2d41cdcb82fffa1cc" UNIQUE ("workspace_id", "name"), CONSTRAINT "installations_compatibility" CHECK ("compatibility" IN ('unverified', 'verified')), CONSTRAINT "installations_adapter_version" CHECK (length("adapter_version") <= 32), CONSTRAINT "installations_adapter_key" CHECK (length("adapter_key") <= 64), CONSTRAINT "installations_name" CHECK ("name" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'), CONSTRAINT "PK_21c7fb94d81eca7a66e64bd2b7f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "installations_environment" ON "nodrail"."installations"  ("workspace_id", "environment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "installations_agent" ON "nodrail"."installations"  ("workspace_id", "agent_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "installations_one_live_per_environment" ON "nodrail"."installations"  ("workspace_id", "agent_id", "environment_id") WHERE "archived_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."installation_credentials" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "public_prefix" text NOT NULL, "secret_digest" text NOT NULL, "scopes" text array NOT NULL, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_by" uuid, "last_used_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_9372517c02c72c525a7cfa4e31e" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_b53a585e6c10aadc35530c32e85" UNIQUE ("public_prefix"), CONSTRAINT "credentials_prefix" CHECK (length("public_prefix") BETWEEN 8 AND 32), CONSTRAINT "PK_65720d59685939d50a3cb56e699" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "installation_credentials_installation" ON "nodrail"."installation_credentials"  ("workspace_id", "installation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."policy_rules" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "policy_version_id" uuid NOT NULL, "logical_rule_id" uuid NOT NULL, "rule_revision" integer NOT NULL DEFAULT '1', "name" text NOT NULL, "agent_id" uuid, "installation_id" uuid, "tool_key" text NOT NULL, "operation_key" text NOT NULL, "operation_schema_version" integer NOT NULL DEFAULT '1', "effect" text NOT NULL, "resource_scope" jsonb NOT NULL, "conditions" jsonb NOT NULL DEFAULT '[]', "expires_at" TIMESTAMP WITH TIME ZONE, "updated_by" uuid NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_f18f348b449bb54aeec7eae6d72" UNIQUE ("workspace_id", "policy_version_id", "logical_rule_id"), CONSTRAINT "policy_rules_effect" CHECK ("effect" IN ('deny', 'require_approval', 'allow')), CONSTRAINT "policy_rules_operation" CHECK (length("operation_key") <= 128), CONSTRAINT "policy_rules_tool" CHECK (length("tool_key") <= 64), CONSTRAINT "policy_rules_name" CHECK (length("name") BETWEEN 1 AND 120), CONSTRAINT "policy_rules_revision" CHECK ("rule_revision" > 0), CONSTRAINT "PK_64c7f7b8bb8abd8351075e774b9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "policy_rules_logical" ON "nodrail"."policy_rules"  ("workspace_id", "logical_rule_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "policy_rules_version" ON "nodrail"."policy_rules"  ("workspace_id", "policy_version_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."action_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "agent_id" uuid NOT NULL, "environment_id" uuid NOT NULL, "idempotency_key" text NOT NULL, "adapter_version" text, "schema_version" integer NOT NULL DEFAULT '1', "canonicalizer_version" integer NOT NULL DEFAULT '1', "tool_key" text NOT NULL, "operation_key" text NOT NULL, "resource_kind" text NOT NULL, "resource_id" text NOT NULL, "params_safe" jsonb NOT NULL DEFAULT '{}', "permission_fingerprint" text NOT NULL, "descriptor_digest" text NOT NULL, "action_digest" text NOT NULL, "initial_policy_version_id" uuid NOT NULL, "access_epoch" integer NOT NULL, "initial_evaluation" text NOT NULL, "attempt_count" integer NOT NULL DEFAULT '1', "last_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "retry_of_action_id" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_a1f817bf4f44cd9293eef473106" UNIQUE ("workspace_id", "id", "installation_id"), CONSTRAINT "UQ_3ac71f87f6ab33fc31bb33043d2" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_154ad9c0c63babfbf8340604b40" UNIQUE ("workspace_id", "installation_id", "idempotency_key"), CONSTRAINT "action_requests_expiry" CHECK ("expires_at" > "created_at"), CONSTRAINT "action_requests_attempts" CHECK ("attempt_count" > 0), CONSTRAINT "action_requests_evaluation" CHECK ("initial_evaluation" IN ('ready', 'approval_pending', 'unknown_permission_blocked', 'denied')), CONSTRAINT "action_requests_params" CHECK (pg_column_size("params_safe") <= 32768), CONSTRAINT "action_requests_resource" CHECK (length("resource_id") <= 512), CONSTRAINT "action_requests_kind" CHECK (length("resource_kind") <= 64), CONSTRAINT "action_requests_operation" CHECK (length("operation_key") <= 128), CONSTRAINT "action_requests_tool" CHECK (length("tool_key") <= 64), CONSTRAINT "action_requests_key" CHECK (length("idempotency_key") <= 128), CONSTRAINT "PK_09b916ea588ef64efc8be0069ea" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "action_requests_environment" ON "nodrail"."action_requests"  ("workspace_id", "environment_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "action_requests_installation" ON "nodrail"."action_requests"  ("workspace_id", "installation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "action_requests_agent" ON "nodrail"."action_requests"  ("workspace_id", "agent_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."approval_requests" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "reason" text NOT NULL, "state" text NOT NULL DEFAULT 'pending', "invalidated_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "decided_by" uuid, "decided_session_id" uuid, "decided_at" TIMESTAMP WITH TIME ZONE, "decided_policy_version_id" uuid, CONSTRAINT "UQ_ca643987f269001326365d03859" UNIQUE ("workspace_id", "id", "action_request_id"), CONSTRAINT "UQ_b065d9847ae24b15d2a9b76fed6" UNIQUE ("workspace_id", "id"), CONSTRAINT "UQ_ee8048bd1bcc2b11d0cf257351c" UNIQUE ("workspace_id", "action_request_id"), CONSTRAINT "approvals_decided" CHECK ("state" NOT IN ('approved_once', 'denied') OR ("decided_by" IS NOT NULL AND "decided_session_id" IS NOT NULL AND "decided_at" IS NOT NULL)), CONSTRAINT "approvals_pending" CHECK ("state" <> 'pending' OR "decided_at" IS NULL), CONSTRAINT "approvals_invalidated" CHECK (("invalidated_reason" IS NOT NULL) = ("state" = 'invalidated')), CONSTRAINT "approvals_expiry" CHECK ("expires_at" > "created_at"), CONSTRAINT "approvals_invalidated_reason" CHECK ("invalidated_reason" IN ('policy_changed', 'agent_paused', 'credential_revoked', 'approver_access_removed')), CONSTRAINT "approvals_state" CHECK ("state" IN ('pending', 'approved_once', 'denied', 'expired', 'invalidated')), CONSTRAINT "approvals_reason" CHECK ("reason" IN ('new_permission', 'rule_requires_review')), CONSTRAINT "PK_484806bb8ff331b851fc75973c0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "approval_requests_decider" ON "nodrail"."approval_requests"  ("workspace_id", "decided_by") WHERE "state" = 'approved_once'`,
    );
    await queryRunner.query(
      `CREATE INDEX "approval_requests_queue" ON "nodrail"."approval_requests"  ("workspace_id", "state", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."decision_permits" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "approval_request_id" uuid, "policy_version_id" uuid NOT NULL, "credential_id" uuid NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "claim_nonce_digest" text NOT NULL, CONSTRAINT "UQ_006891c325d5b06a7a4b9e96b28" UNIQUE ("workspace_id", "id", "action_request_id"), CONSTRAINT "UQ_7cf2129027713e2675fae3cf649" UNIQUE ("workspace_id", "action_request_id"), CONSTRAINT "PK_612f6ecfa52517f33f638e61ff8" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "decision_permits_one_per_approval" ON "nodrail"."decision_permits"  ("workspace_id", "approval_request_id") WHERE "approval_request_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."client_reports" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "action_request_id" uuid NOT NULL, "permit_id" uuid, "client_report_key" text NOT NULL, "outcome" text NOT NULL, "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "details_safe" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "UQ_66ef8fdc650b7fabc2dde6b3361" UNIQUE ("workspace_id", "installation_id", "client_report_key"), CONSTRAINT "client_reports_details" CHECK (pg_column_size("details_safe") <= 8192), CONSTRAINT "client_reports_outcome" CHECK ("outcome" IN ('success', 'failure', 'unknown')), CONSTRAINT "client_reports_key" CHECK (length("client_report_key") <= 128), CONSTRAINT "PK_dfa3df4bb28e57633e4c1034c5f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "client_reports_action" ON "nodrail"."client_reports"  ("workspace_id", "action_request_id", "received_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."observed_permissions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "installation_id" uuid NOT NULL, "permission_fingerprint" text NOT NULL, "tool_key" text NOT NULL, "operation_key" text NOT NULL, "resource_kind" text NOT NULL, "resource_label" text NOT NULL, "operation_schema_version" integer NOT NULL DEFAULT '1', "manifest_version" text, "attempt_count" integer NOT NULL DEFAULT '1', "last_outcome" text NOT NULL, "last_action_request_id" uuid, "first_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), CONSTRAINT "UQ_d852bc9da9fc8b8d8b46045ce74" UNIQUE ("workspace_id", "installation_id", "permission_fingerprint"), CONSTRAINT "observed_outcome" CHECK ("last_outcome" IN ('allowed_by_rule', 'denied_by_rule', 'needs_approval', 'unknown_blocked', 'observed_only')), CONSTRAINT "observed_attempts" CHECK ("attempt_count" > 0), CONSTRAINT "observed_label" CHECK (length("resource_label") <= 512), CONSTRAINT "observed_kind" CHECK (length("resource_kind") <= 64), CONSTRAINT "observed_operation" CHECK (length("operation_key") <= 128), CONSTRAINT "observed_tool" CHECK (length("tool_key") <= 64), CONSTRAINT "PK_e35f6c746e509c36dd051dc1829" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "observed_permissions_recent" ON "nodrail"."observed_permissions"  ("workspace_id", "installation_id", "last_seen_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "nodrail"."audit_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL, "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT clock_timestamp(), "event_type" text NOT NULL, "actor_kind" text NOT NULL, "actor_user_id" uuid, "actor_credential_id" uuid, "action_request_id" uuid, "agent_id" uuid, "environment_id" uuid, "policy_version_id" uuid, "matched_logical_rule_id" uuid, "decision_code" text NOT NULL, "correlation_id" uuid NOT NULL DEFAULT gen_random_uuid(), "payload_safe" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "audit_actor" CHECK (("actor_kind" = 'human') = ("actor_user_id" IS NOT NULL)), CONSTRAINT "audit_payload" CHECK (pg_column_size("payload_safe") <= 8192), CONSTRAINT "audit_decision_code" CHECK (length("decision_code") <= 64), CONSTRAINT "audit_actor_kind" CHECK ("actor_kind" IN ('human', 'runtime', 'system')), CONSTRAINT "audit_event_type" CHECK (length("event_type") <= 64), CONSTRAINT "PK_910f64d901a5c3e9878f0d4a407" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_events_agent" ON "nodrail"."audit_events"  ("workspace_id", "agent_id", "occurred_at") WHERE "agent_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_events_action" ON "nodrail"."audit_events"  ("workspace_id", "action_request_id") WHERE "action_request_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "audit_events_list" ON "nodrail"."audit_events"  ("workspace_id", "environment_id", "occurred_at", "id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."external_auth_accounts" ADD CONSTRAINT "FK_fdec42dbf6756c7238c1a9f4eee" FOREIGN KEY ("user_id") REFERENCES "nodrail"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."human_sessions" ADD CONSTRAINT "FK_c5a765c85ad5667aabbcbec8595" FOREIGN KEY ("external_auth_account_id", "user_id") REFERENCES "nodrail"."external_auth_accounts"("id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspaces" ADD CONSTRAINT "FK_871be6c0ca11c744858caf1d154" FOREIGN KEY ("default_environment_id", "id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_memberships" ADD CONSTRAINT "FK_c478a264ff4081763bb45418ca9" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_memberships" ADD CONSTRAINT "FK_14cd888d48ea02703648cff0be6" FOREIGN KEY ("user_id") REFERENCES "nodrail"."users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_invites" ADD CONSTRAINT "FK_9ffc4e5b893e8fb91d66d466f6d" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_invites" ADD CONSTRAINT "FK_9c84c847e70e999cca781652367" FOREIGN KEY ("workspace_id", "inviter_user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."notification_preferences" ADD CONSTRAINT "FK_2b52260d86edb37e9900582de51" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."environments" ADD CONSTRAINT "FK_8dd4bba1c98194a69ed33a27609" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_versions" ADD CONSTRAINT "FK_f9db16e6cf61ba3cf8be39e18e1" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_versions" ADD CONSTRAINT "FK_80491021a3035e839cc16410935" FOREIGN KEY ("workspace_id", "published_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."active_policies" ADD CONSTRAINT "FK_3725c6296b015258892ee624b2b" FOREIGN KEY ("policy_version_id", "workspace_id", "environment_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id","environment_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agents" ADD CONSTRAINT "FK_e4073e164112770e13f73919bac" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agents" ADD CONSTRAINT "FK_9143dc099337a6fd7ec7974e827" FOREIGN KEY ("workspace_id", "paused_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agent_members" ADD CONSTRAINT "FK_de576c1d9de8d50e9d8ff1cc515" FOREIGN KEY ("agent_id", "workspace_id") REFERENCES "nodrail"."agents"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agent_members" ADD CONSTRAINT "FK_481cc75997fc3568a6aa6b05751" FOREIGN KEY ("workspace_id", "user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installations" ADD CONSTRAINT "FK_8d64e3c91e2a26236609206de6a" FOREIGN KEY ("agent_id", "workspace_id") REFERENCES "nodrail"."agents"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installations" ADD CONSTRAINT "FK_14b9a2d110aa333bd3ab72f4d67" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" ADD CONSTRAINT "FK_4fd2e64b4c876ee93bf77e78458" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" ADD CONSTRAINT "FK_bc6e561ae5ce8b26553710aa960" FOREIGN KEY ("workspace_id", "created_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" ADD CONSTRAINT "FK_63cac5c58ad3e0163f0bc4fff4e" FOREIGN KEY ("workspace_id", "revoked_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" ADD CONSTRAINT "FK_da9c91e88db961ddc0b01c22959" FOREIGN KEY ("policy_version_id", "workspace_id", "environment_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id","environment_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" ADD CONSTRAINT "FK_f0392410981150a9e1d37b4e444" FOREIGN KEY ("agent_id", "workspace_id") REFERENCES "nodrail"."agents"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" ADD CONSTRAINT "FK_eeccddbc1ec0f2dc4c35b43b520" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" ADD CONSTRAINT "FK_8dd651301c03a439455e5b666ea" FOREIGN KEY ("workspace_id", "updated_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "FK_b3d008603ed51ef1157e5c13411" FOREIGN KEY ("installation_id", "workspace_id", "agent_id", "environment_id") REFERENCES "nodrail"."installations"("id","workspace_id","agent_id","environment_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "FK_280ad2c642af3bec2c307849ae2" FOREIGN KEY ("initial_policy_version_id", "workspace_id", "environment_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id","environment_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" ADD CONSTRAINT "FK_ea59f73f93e2b0cd8a5e3016713" FOREIGN KEY ("retry_of_action_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "FK_ee8048bd1bcc2b11d0cf257351c" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "FK_46bf120d1bb4b3beeb29541756e" FOREIGN KEY ("workspace_id", "decided_by") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "FK_7bf6b0ddc4b615f248bee686667" FOREIGN KEY ("decided_session_id", "decided_by") REFERENCES "nodrail"."human_sessions"("id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" ADD CONSTRAINT "FK_65ba7ebecd6d2437372d7db4f12" FOREIGN KEY ("decided_policy_version_id", "workspace_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" ADD CONSTRAINT "FK_7cf2129027713e2675fae3cf649" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" ADD CONSTRAINT "FK_a620d047b5a92a4b441c18c97c4" FOREIGN KEY ("approval_request_id", "workspace_id", "action_request_id") REFERENCES "nodrail"."approval_requests"("id","workspace_id","action_request_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" ADD CONSTRAINT "FK_2159359df0db1c2ff36a00d08ff" FOREIGN KEY ("policy_version_id", "workspace_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" ADD CONSTRAINT "FK_fb7a69fa9cf8be31faefb224216" FOREIGN KEY ("credential_id", "workspace_id") REFERENCES "nodrail"."installation_credentials"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."client_reports" ADD CONSTRAINT "FK_ac470f78a050c55654955879f9d" FOREIGN KEY ("action_request_id", "workspace_id", "installation_id") REFERENCES "nodrail"."action_requests"("id","workspace_id","installation_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."client_reports" ADD CONSTRAINT "FK_06c90f35e5670fc2bb2d6742727" FOREIGN KEY ("permit_id", "workspace_id", "action_request_id") REFERENCES "nodrail"."decision_permits"("id","workspace_id","action_request_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."observed_permissions" ADD CONSTRAINT "FK_934609ec1687f669ec3e6ff48b1" FOREIGN KEY ("installation_id", "workspace_id") REFERENCES "nodrail"."installations"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."observed_permissions" ADD CONSTRAINT "FK_a91ea048a563e380223f97bd559" FOREIGN KEY ("last_action_request_id", "workspace_id", "installation_id") REFERENCES "nodrail"."action_requests"("id","workspace_id","installation_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_ce538042f1afc3b80bfa0fb2de2" FOREIGN KEY ("workspace_id") REFERENCES "nodrail"."workspaces"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_c7204b64051719aebd7fe7963c7" FOREIGN KEY ("workspace_id", "actor_user_id") REFERENCES "nodrail"."workspace_memberships"("workspace_id","user_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_fc70472682da69e187cbee75acd" FOREIGN KEY ("actor_credential_id", "workspace_id") REFERENCES "nodrail"."installation_credentials"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_52f4554165919f723e4cc118d6b" FOREIGN KEY ("action_request_id", "workspace_id") REFERENCES "nodrail"."action_requests"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_d62fb2632bbeed4531e1a08ea6a" FOREIGN KEY ("agent_id", "workspace_id") REFERENCES "nodrail"."agents"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_cd03544261a92ade25214a69bb9" FOREIGN KEY ("environment_id", "workspace_id") REFERENCES "nodrail"."environments"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" ADD CONSTRAINT "FK_b3fdd40f7b0c65276682f6b2987" FOREIGN KEY ("policy_version_id", "workspace_id") REFERENCES "nodrail"."policy_versions"("id","workspace_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_b3fdd40f7b0c65276682f6b2987"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_cd03544261a92ade25214a69bb9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_d62fb2632bbeed4531e1a08ea6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_52f4554165919f723e4cc118d6b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_fc70472682da69e187cbee75acd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_c7204b64051719aebd7fe7963c7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."audit_events" DROP CONSTRAINT "FK_ce538042f1afc3b80bfa0fb2de2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."observed_permissions" DROP CONSTRAINT "FK_a91ea048a563e380223f97bd559"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."observed_permissions" DROP CONSTRAINT "FK_934609ec1687f669ec3e6ff48b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."client_reports" DROP CONSTRAINT "FK_06c90f35e5670fc2bb2d6742727"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."client_reports" DROP CONSTRAINT "FK_ac470f78a050c55654955879f9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" DROP CONSTRAINT "FK_fb7a69fa9cf8be31faefb224216"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" DROP CONSTRAINT "FK_2159359df0db1c2ff36a00d08ff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" DROP CONSTRAINT "FK_a620d047b5a92a4b441c18c97c4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."decision_permits" DROP CONSTRAINT "FK_7cf2129027713e2675fae3cf649"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "FK_65ba7ebecd6d2437372d7db4f12"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "FK_7bf6b0ddc4b615f248bee686667"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "FK_46bf120d1bb4b3beeb29541756e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."approval_requests" DROP CONSTRAINT "FK_ee8048bd1bcc2b11d0cf257351c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "FK_ea59f73f93e2b0cd8a5e3016713"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "FK_280ad2c642af3bec2c307849ae2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."action_requests" DROP CONSTRAINT "FK_b3d008603ed51ef1157e5c13411"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" DROP CONSTRAINT "FK_8dd651301c03a439455e5b666ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" DROP CONSTRAINT "FK_eeccddbc1ec0f2dc4c35b43b520"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" DROP CONSTRAINT "FK_f0392410981150a9e1d37b4e444"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_rules" DROP CONSTRAINT "FK_da9c91e88db961ddc0b01c22959"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" DROP CONSTRAINT "FK_63cac5c58ad3e0163f0bc4fff4e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" DROP CONSTRAINT "FK_bc6e561ae5ce8b26553710aa960"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installation_credentials" DROP CONSTRAINT "FK_4fd2e64b4c876ee93bf77e78458"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installations" DROP CONSTRAINT "FK_14b9a2d110aa333bd3ab72f4d67"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."installations" DROP CONSTRAINT "FK_8d64e3c91e2a26236609206de6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agent_members" DROP CONSTRAINT "FK_481cc75997fc3568a6aa6b05751"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agent_members" DROP CONSTRAINT "FK_de576c1d9de8d50e9d8ff1cc515"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agents" DROP CONSTRAINT "FK_9143dc099337a6fd7ec7974e827"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."agents" DROP CONSTRAINT "FK_e4073e164112770e13f73919bac"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."active_policies" DROP CONSTRAINT "FK_3725c6296b015258892ee624b2b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_versions" DROP CONSTRAINT "FK_80491021a3035e839cc16410935"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."policy_versions" DROP CONSTRAINT "FK_f9db16e6cf61ba3cf8be39e18e1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."environments" DROP CONSTRAINT "FK_8dd4bba1c98194a69ed33a27609"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."notification_preferences" DROP CONSTRAINT "FK_2b52260d86edb37e9900582de51"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_invites" DROP CONSTRAINT "FK_9c84c847e70e999cca781652367"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_invites" DROP CONSTRAINT "FK_9ffc4e5b893e8fb91d66d466f6d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_memberships" DROP CONSTRAINT "FK_14cd888d48ea02703648cff0be6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspace_memberships" DROP CONSTRAINT "FK_c478a264ff4081763bb45418ca9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."workspaces" DROP CONSTRAINT "FK_871be6c0ca11c744858caf1d154"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."human_sessions" DROP CONSTRAINT "FK_c5a765c85ad5667aabbcbec8595"`,
    );
    await queryRunner.query(
      `ALTER TABLE "nodrail"."external_auth_accounts" DROP CONSTRAINT "FK_fdec42dbf6756c7238c1a9f4eee"`,
    );
    await queryRunner.query(`DROP INDEX "nodrail"."audit_events_list"`);
    await queryRunner.query(`DROP INDEX "nodrail"."audit_events_action"`);
    await queryRunner.query(`DROP INDEX "nodrail"."audit_events_agent"`);
    await queryRunner.query(`DROP TABLE "nodrail"."audit_events"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."observed_permissions_recent"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."observed_permissions"`);
    await queryRunner.query(`DROP INDEX "nodrail"."client_reports_action"`);
    await queryRunner.query(`DROP TABLE "nodrail"."client_reports"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."decision_permits_one_per_approval"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."decision_permits"`);
    await queryRunner.query(`DROP INDEX "nodrail"."approval_requests_queue"`);
    await queryRunner.query(`DROP INDEX "nodrail"."approval_requests_decider"`);
    await queryRunner.query(`DROP TABLE "nodrail"."approval_requests"`);
    await queryRunner.query(`DROP INDEX "nodrail"."action_requests_agent"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."action_requests_installation"`,
    );
    await queryRunner.query(
      `DROP INDEX "nodrail"."action_requests_environment"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."action_requests"`);
    await queryRunner.query(`DROP INDEX "nodrail"."policy_rules_version"`);
    await queryRunner.query(`DROP INDEX "nodrail"."policy_rules_logical"`);
    await queryRunner.query(`DROP TABLE "nodrail"."policy_rules"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."installation_credentials_installation"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."installation_credentials"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."installations_one_live_per_environment"`,
    );
    await queryRunner.query(`DROP INDEX "nodrail"."installations_agent"`);
    await queryRunner.query(`DROP INDEX "nodrail"."installations_environment"`);
    await queryRunner.query(`DROP TABLE "nodrail"."installations"`);
    await queryRunner.query(`DROP INDEX "nodrail"."agent_members_user"`);
    await queryRunner.query(`DROP TABLE "nodrail"."agent_members"`);
    await queryRunner.query(`DROP INDEX "nodrail"."agents_list"`);
    await queryRunner.query(`DROP TABLE "nodrail"."agents"`);
    await queryRunner.query(`DROP TABLE "nodrail"."active_policies"`);
    await queryRunner.query(`DROP TABLE "nodrail"."policy_versions"`);
    await queryRunner.query(`DROP TABLE "nodrail"."environments"`);
    await queryRunner.query(`DROP TABLE "nodrail"."notification_preferences"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."workspace_invites_one_pending"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."workspace_invites"`);
    await queryRunner.query(
      `DROP INDEX "nodrail"."workspace_memberships_user"`,
    );
    await queryRunner.query(
      `DROP INDEX "nodrail"."workspace_memberships_one_owner"`,
    );
    await queryRunner.query(`DROP TABLE "nodrail"."workspace_memberships"`);
    await queryRunner.query(`DROP TABLE "nodrail"."workspaces"`);
    await queryRunner.query(`DROP TABLE "nodrail"."human_sessions"`);
    await queryRunner.query(`DROP TABLE "nodrail"."external_auth_accounts"`);
    await queryRunner.query(`DROP TABLE "nodrail"."users"`);
  }
}
