import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryColumn,
  Generated,
  Unique,
  type Relation,
} from "typeorm";
import type { Role } from "@/contracts/v1/access";
import {
  Clock,
  CreatedAt,
  Fk,
  Id,
  Int,
  Json,
  OptionalSeq,
  OptionalText,
  OptionalTime,
  OptionalUuid,
  Text,
  Time,
  Uuid,
  inWorkspace,
  keyPattern,
  tokenOf,
  member,
  schema,
  slugPattern,
} from "./columns";
import { Run, RunStep } from "./run-entities";
import { PersonalAccessToken } from "./token-entities";

/**
 * The product schema, kept in one file so entities can reference each other
 * without circular imports. Row level security, grants and the owner trigger
 * cannot be expressed here: they live in the access-control migration.
 *
 * Every tenant table carries workspace_id, and foreign keys include it, so the
 * database itself refuses links between workspaces.
 */

// Identity ------------------------------------------------------------------

@Entity({ schema, name: "users" })
@Check("users_display_name", `length("display_name") BETWEEN 1 AND 120`)
@Check("users_email", `length("verified_email") <= 254`)
@Check("users_status", `"status" IN ('active', 'suspended')`)
export class User {
  @Id() id!: string;
  @Text() displayName!: string;
  @OptionalText() verifiedEmail!: string | null;
  @Text({ default: "active" }) status!: "active" | "suspended";
  @CreatedAt() createdAt!: Date;
}

@Entity({ schema, name: "external_auth_accounts" })
@Unique(["provider", "issuer", "subject"])
@Unique(["id", "userId"])
export class ExternalAuthAccount {
  @Id() id!: string;
  @Uuid() userId!: string;
  @Text() provider!: string;
  @Text() issuer!: string;
  @Text() subject!: string;
  @Fk(() => User, { user_id: "id" }) user!: Relation<User>;
}

@Entity({ schema, name: "human_sessions" })
@Unique(["externalAuthAccountId", "providerSessionId"])
@Unique(["id", "userId"])
@Unique("human_sessions_token_digest", ["tokenDigest"])
@Index("human_sessions_user", ["userId"])
@Check(
  "human_sessions_login_source",
  `("token_digest" IS NOT NULL AND "external_auth_account_id" IS NULL AND "provider_session_id" IS NULL) OR ("token_digest" IS NULL AND "external_auth_account_id" IS NOT NULL AND "provider_session_id" IS NOT NULL)`,
)
@Check("human_sessions_expiry", `"expires_at" > "created_at"`)
export class HumanSession {
  @Id() id!: string;
  @Uuid() userId!: string;
  @OptionalUuid() externalAuthAccountId!: string | null;
  @OptionalText() providerSessionId!: string | null;
  @OptionalText() tokenDigest!: string | null;
  @Fk(() => User, { user_id: "id" }) user!: Relation<User>;
  @CreatedAt() createdAt!: Date;
  @Time() expiresAt!: Date;
  @OptionalTime() revokedAt!: Date | null;
  @Fk(
    () => ExternalAuthAccount,
    { external_auth_account_id: "id", user_id: "userId" },
    { nullable: true },
  )
  account!: Relation<ExternalAuthAccount> | null;
}

// Workspaces and membership -------------------------------------------------

@Entity({ schema, name: "workspaces" })
@Unique(["slug"])
@Check("workspaces_name", `length("name") BETWEEN 1 AND 120`)
@Check("workspaces_slug", `"slug" ~ ${slugPattern}`)
export class Workspace {
  @Id() id!: string;
  @Text() name!: string;
  @Text() slug!: string;
  @OptionalUuid() defaultEnvironmentId!: string | null;
  @CreatedAt() createdAt!: Date;
  @OptionalTime() archivedAt!: Date | null;
  @Fk(
    () => Environment,
    { id: "workspaceId", default_environment_id: "id" },
    { nullable: true },
  )
  defaultEnvironment!: Relation<Environment> | null;
}

@Entity({ schema, name: "workspace_memberships" })
@Check("memberships_role", `"role" IN ('admin', 'policy_manager', 'viewer')`)
@Check("memberships_status", `"status" IN ('active', 'revoked')`)
@Check(
  "memberships_revoked",
  `("status" = 'revoked') = ("revoked_at" IS NOT NULL)`,
)
@Check(
  "memberships_owner_active_admin",
  `NOT "is_owner" OR ("role" = 'admin' AND "status" = 'active')`,
)
@Index("workspace_memberships_user", ["userId", "status"])
@Index("workspace_memberships_one_owner", ["workspaceId"], {
  unique: true,
  where: `"is_owner" = true`,
})
export class WorkspaceMembership {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) userId!: string;
  @Text() role!: Role;
  @Column({ type: "boolean", default: false }) isOwner!: boolean;
  @Text({ default: "active" }) status!: "active" | "revoked";
  @CreatedAt() createdAt!: Date;
  @OptionalTime() revokedAt!: Date | null;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
  @Fk(() => User, { user_id: "id" }) user!: Relation<User>;
}

@Entity({ schema, name: "workspace_invites" })
@Unique(["tokenDigest"])
@Unique(["workspaceId", "id"])
@Index("workspace_invites_one_pending", ["workspaceId", "normalizedEmail"], {
  unique: true,
  where: `"status" = 'pending'`,
})
@Check(
  "invites_email",
  `"normalized_email" = lower("normalized_email") AND length("normalized_email") <= 254`,
)
@Check("invites_role", `"proposed_role" IN ('policy_manager', 'viewer')`)
@Check("invites_status", `"status" IN ('pending', 'accepted', 'revoked')`)
@Check("invites_expiry", `"expires_at" > "created_at"`)
@Check(
  "invites_accepted",
  `("status" = 'accepted') = ("accepted_at" IS NOT NULL)`,
)
export class WorkspaceInvite {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Text() normalizedEmail!: string;
  @Text() proposedRole!: Exclude<Role, "admin">;
  @Text() tokenDigest!: string;
  @Uuid() inviterUserId!: string;
  @Text({ default: "pending" }) status!: "pending" | "accepted" | "revoked";
  @CreatedAt() createdAt!: Date;
  @Time() expiresAt!: Date;
  @OptionalUuid() acceptedBy!: string | null;
  @OptionalTime() acceptedAt!: Date | null;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
  @Fk(() => WorkspaceMembership, member("inviter_user_id"))
  inviter!: Relation<WorkspaceMembership>;
}

@Entity({ schema, name: "notification_preferences" })
export class NotificationPreferences {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) userId!: string;
  @Column({ type: "boolean", default: true }) integrationStale!: boolean;
  @Column({ type: "boolean", default: true }) usageAlerts!: boolean;
  @CreatedAt() updatedAt!: Date;
  @Fk(() => WorkspaceMembership, member("user_id"))
  membership!: Relation<WorkspaceMembership>;
}

// Environments and policy history -------------------------------------------

@Entity({ schema, name: "environments" })
@Unique(["workspaceId", "slug"])
@Unique(["workspaceId", "id"])
@Check("environments_slug", `"slug" ~ ${slugPattern}`)
@Check("environments_name", `length("name") BETWEEN 1 AND 80`)
export class Environment {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Text() slug!: string;
  @Text() name!: string;
  @CreatedAt() createdAt!: Date;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
}

@Entity({ schema, name: "policy_versions" })
@Unique(["workspaceId", "environmentId", "revision"])
@Unique(["workspaceId", "environmentId", "id"])
@Unique(["workspaceId", "id"])
@Check("policy_versions_revision", `"revision" > 0`)
@Check(
  "policy_versions_managed",
  `("managed_project_id" IS NULL AND "managed_revision" IS NULL AND "managed_policy_revision" IS NULL) OR ("managed_project_id" IS NOT NULL AND "managed_revision" ~ '^[0-9a-f]{64}$' AND ("managed_policy_revision" IS NULL OR "managed_policy_revision" ~ '^[0-9a-f]{64}$'))`,
)
@Check(
  "policy_versions_source",
  `("source_text" IS NULL AND "source_digest" IS NULL) OR ("source_text" IS NOT NULL AND "source_digest" ~ '^[0-9a-f]{64}$')`,
)
export class PolicyVersion {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Int() revision!: number;
  @Int({ default: 1 }) schemaVersion!: number;
  @Uuid() publishedBy!: string;
  @Clock() publishedAt!: Date;
  /** The version's gates and budgets, as the engine reads them. Null: none. */
  @Column({ type: "jsonb", nullable: true }) runPolicy!: object | null;
  /** The repository project `nodrail apply` published it from, or null. */
  @OptionalUuid() managedProjectId!: string | null;
  /** That project's workspace revision: its lock's digest. */
  @OptionalText() managedRevision!: string | null;
  /** That lock's effective policy digest. */
  @OptionalText() managedPolicyRevision!: string | null;
  /** The file it was published from, and its SHA-256; null when made on screen. */
  @OptionalText() sourceText!: string | null;
  @OptionalText() sourceDigest!: string | null;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => WorkspaceMembership, member("published_by"))
  publisher!: Relation<WorkspaceMembership>;
}

/** Which version is live. Separate so published versions never change. */
@Entity({ schema, name: "active_policies" })
export class ActivePolicy {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) environmentId!: string;
  @Uuid() policyVersionId!: string;
  @Clock() activatedAt!: Date;
  @Fk(() => PolicyVersion, {
    workspace_id: "workspaceId",
    environment_id: "environmentId",
    policy_version_id: "id",
  })
  policyVersion!: Relation<PolicyVersion>;
}

// Agents, installations, credentials ----------------------------------------

@Entity({ schema, name: "agents" })
@Unique(["workspaceId", "externalKey"])
@Unique(["workspaceId", "id"])
@Index("agents_list", ["workspaceId", "createdAt", "id"])
@Check("agents_external_key", `"external_key" ~ ${keyPattern}`)
@Check("agents_description", `length("description") <= 200`)
@Check("agents_access_status", `"access_status" IN ('active', 'paused')`)
@Check("agents_access_epoch", `"access_epoch" > 0`)
@Check(
  "agents_paused",
  `("access_status" = 'paused') = ("paused_at" IS NOT NULL)`,
)
export class Agent {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Text() externalKey!: string;
  @OptionalText() description!: string | null;
  @Text({ default: "active" }) accessStatus!: "active" | "paused";
  @Int({ default: 1 }) accessEpoch!: number;
  @OptionalTime() pausedAt!: Date | null;
  @OptionalUuid() pausedBy!: string | null;
  @Clock() createdAt!: Date;
  @OptionalTime() archivedAt!: Date | null;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
  @Fk(() => WorkspaceMembership, member("paused_by"), { nullable: true })
  pauser!: Relation<WorkspaceMembership> | null;
}

/** Who an agent belongs to, for the per-person view. */
@Entity({ schema, name: "agent_members" })
@Index("agent_members_user", ["workspaceId", "userId"])
export class AgentMember {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) agentId!: string;
  @PrimaryColumn({ type: "uuid" }) userId!: string;
  @CreatedAt() createdAt!: Date;
  @Fk(() => Agent, inWorkspace("agent_id")) agent!: Relation<Agent>;
  @Fk(() => WorkspaceMembership, member("user_id"))
  membership!: Relation<WorkspaceMembership>;
}

@Entity({ schema, name: "installations" })
@Unique(["workspaceId", "name"])
@Unique(["workspaceId", "id"])
@Unique(["workspaceId", "id", "agentId", "environmentId"])
@Index(
  "installations_one_live_per_environment",
  ["workspaceId", "agentId", "environmentId"],
  { unique: true, where: `"archived_at" IS NULL` },
)
@Index("installations_agent", ["workspaceId", "agentId"])
@Index("installations_environment", ["workspaceId", "environmentId"])
@Check("installations_name", `"name" ~ ${keyPattern}`)
@Check("installations_adapter_key", `length("adapter_key") <= 64`)
@Check("installations_adapter_version", `length("adapter_version") <= 32`)
@Check(
  "installations_compatibility",
  `"compatibility" IN ('unverified', 'verified')`,
)
@Check(
  "installations_heartbeat_policy_digest",
  `"heartbeat_policy_digest" ~ '^[0-9a-f]{64}$'`,
)
export class Installation {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() agentId!: string;
  @Uuid() environmentId!: string;
  @Text() name!: string;
  @Text() adapterKey!: string;
  @OptionalText() adapterVersion!: string | null;
  @Text({ default: "unverified" }) compatibility!: "unverified" | "verified";
  @OptionalText() heartbeatPolicyDigest!: string | null;
  @Column({ type: "boolean", nullable: true }) heartbeatPolicySkew!:
    boolean | null;
  @OptionalTime() lastSeenAt!: Date | null;
  @Clock() createdAt!: Date;
  @OptionalTime() archivedAt!: Date | null;
  @Fk(() => Agent, inWorkspace("agent_id")) agent!: Relation<Agent>;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
}

@Entity({ schema, name: "installation_credentials" })
@Unique(["publicPrefix"])
@Unique(["workspaceId", "id"])
@Index("installation_credentials_installation", [
  "workspaceId",
  "installationId",
])
@Index("installation_credentials_one_live", ["workspaceId", "installationId"], {
  unique: true,
  where: `"revoked_at" IS NULL`,
})
@Check("credentials_prefix", `length("public_prefix") BETWEEN 8 AND 32`)
export class InstallationCredential {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() installationId!: string;
  @Text() publicPrefix!: string;
  @Text() secretDigest!: string;
  @Column({ type: "text", array: true }) scopes!: string[];
  @Uuid() createdBy!: string;
  @Clock() createdAt!: Date;
  @OptionalTime() expiresAt!: Date | null;
  @OptionalTime() revokedAt!: Date | null;
  @OptionalUuid() revokedBy!: string | null;
  @OptionalTime() lastUsedAt!: Date | null;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
  @Fk(() => WorkspaceMembership, member("created_by"))
  creator!: Relation<WorkspaceMembership>;
  @Fk(() => WorkspaceMembership, member("revoked_by"), { nullable: true })
  revoker!: Relation<WorkspaceMembership> | null;
}

@Entity({ schema, name: "policy_rules" })
@Unique(["workspaceId", "policyVersionId", "logicalRuleId"])
@Index("policy_rules_version", ["workspaceId", "policyVersionId"])
@Index("policy_rules_logical", ["workspaceId", "logicalRuleId"])
@Check("policy_rules_revision", `"rule_revision" > 0`)
@Check("policy_rules_name", `length("name") BETWEEN 1 AND 120`)
@Check("policy_rules_tool", `length("tool_key") <= 64`)
@Check("policy_rules_operation", `length("operation_key") <= 128`)
@Check("policy_rules_effect", `"effect" IN ('deny', 'allow')`)
export class PolicyRule {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Uuid() policyVersionId!: string;
  @Uuid() logicalRuleId!: string;
  @Int({ default: 1 }) ruleRevision!: number;
  @Text() name!: string;
  @OptionalUuid() agentId!: string | null;
  @OptionalUuid() installationId!: string | null;
  @Text() toolKey!: string;
  @Text() operationKey!: string;
  @Int({ default: 1 }) operationSchemaVersion!: number;
  @Text() effect!: "deny" | "allow";
  @Column({ type: "jsonb" }) resourceScope!: unknown;
  @Json("[]") conditions!: unknown;
  @OptionalTime() expiresAt!: Date | null;
  @Uuid() updatedBy!: string;
  @Time() updatedAt!: Date;
  @Fk(() => PolicyVersion, {
    workspace_id: "workspaceId",
    environment_id: "environmentId",
    policy_version_id: "id",
  })
  policyVersion!: Relation<PolicyVersion>;
  @Fk(() => Agent, inWorkspace("agent_id"), { nullable: true })
  agent!: Relation<Agent> | null;
  @Fk(() => Installation, inWorkspace("installation_id"), { nullable: true })
  installation!: Relation<Installation> | null;
  @Fk(() => WorkspaceMembership, member("updated_by"))
  updater!: Relation<WorkspaceMembership>;
}

// Runs live in their own module; they are tables here like every other.
export { Run, RunStep };

// Requests, decisions, permits ----------------------------------------------

@Entity({ schema, name: "action_requests" })
@Unique(["workspaceId", "installationId", "idempotencyKey"])
@Unique(["workspaceId", "id"])
@Unique(["workspaceId", "id", "installationId"])
@Index("action_requests_agent", ["workspaceId", "agentId"])
@Index("action_requests_installation", ["workspaceId", "installationId"])
@Index("action_requests_recent", ["workspaceId", "environmentId", "createdAt"])
@Index("action_requests_run", ["workspaceId", "runId", "runSeq"], {
  where: `"run_id" IS NOT NULL`,
})
@Check("action_requests_step", `"step_key" IS NULL OR "run_id" IS NOT NULL`)
@Check("action_requests_run_seq", `("run_id" IS NULL) = ("run_seq" IS NULL)`)
@Check("action_requests_key", `length("idempotency_key") <= 128`)
@Check("action_requests_tool", `length("tool_key") <= 64`)
@Check("action_requests_operation", `length("operation_key") <= 128`)
@Check("action_requests_kind", `length("resource_kind") <= 64`)
@Check("action_requests_resource", `length("resource_id") <= 512`)
@Check("action_requests_params", `pg_column_size("params_safe") <= 32768`)
@Check(
  "action_requests_evaluation",
  `"initial_evaluation" IN ('ready', 'denied')`,
)
@Check("action_requests_attempts", `"attempt_count" > 0`)
@Check("action_requests_expiry", `"expires_at" > "created_at"`)
// A call decided on its host (HostDecisions): Cloud's rows carry none of it.
@Check("action_requests_decided_by", `"decided_by" IN ('server', 'host')`)
@Check("action_requests_policy_digest", `"policy_digest" ~ '^[0-9a-f]{64}$'`)
@Check(
  "action_requests_host_rule",
  `length("host_rule_id") <= 128 AND length("host_rule_name") <= 200`,
)
@Check("action_requests_host_reason", `length("host_reason") <= 1000`)
@Check(
  "action_requests_host",
  `("decided_by" = 'server' AND "policy_digest" IS NULL AND "host_rule_id" IS NULL AND "host_rule_name" IS NULL AND "host_reason" IS NULL AND "host_decided_at" IS NULL AND "body_digest" IS NULL) OR ("decided_by" = 'host' AND "host_decided_at" IS NOT NULL AND "body_digest" ~ '^sha256:[0-9a-f]{64}$' AND "run_hold" IS NULL)`,
)
export class ActionRequest {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() installationId!: string;
  @Uuid() agentId!: string;
  @Uuid() environmentId!: string;
  @Text() idempotencyKey!: string;
  @OptionalText() adapterVersion!: string | null;
  @Int({ default: 1 }) schemaVersion!: number;
  @Int({ default: 1 }) canonicalizerVersion!: number;
  @Text() toolKey!: string;
  @Text() operationKey!: string;
  @Text() resourceKind!: string;
  @Text() resourceId!: string;
  @Json("{}") paramsSafe!: object;
  @Text() permissionFingerprint!: string;
  @Text() descriptorDigest!: string;
  @Text() actionDigest!: string;
  @Uuid() initialPolicyVersionId!: string;
  @Int() accessEpoch!: number;
  @Text() initialEvaluation!: string;
  @Int({ default: 1 }) attemptCount!: number;
  @Clock() lastAttemptAt!: Date;
  @OptionalUuid() retryOfActionId!: string | null;
  @Clock() createdAt!: Date;
  @Time() expiresAt!: Date;
  @OptionalUuid() runId!: string | null;
  @OptionalText() stepKey!: string | null;
  @OptionalSeq() runSeq!: string | null;
  /** Whether this action changes anything, as gates' `since` reads it. */
  @Column({ type: "boolean", nullable: true }) runChange!: boolean | null;
  /** The gate or budget that held this action, and what it was missing. */
  @Column({ type: "jsonb", nullable: true }) runHold!: object | null;
  /** Who decided: Cloud, or the hook on its host, which Cloud never re-decides. */
  @Text({ default: "server" }) decidedBy!: "server" | "host";
  @OptionalText() policyDigest!: string | null;
  @Column({ type: "boolean", nullable: true }) policySkew!: boolean | null;
  @OptionalText() hostRuleId!: string | null;
  @OptionalText() hostRuleName!: string | null;
  @OptionalText() hostReason!: string | null;
  @OptionalTime() hostDecidedAt!: Date | null;
  @OptionalText() bodyDigest!: string | null;
  @Fk(() => Installation, {
    workspace_id: "workspaceId",
    installation_id: "id",
    agent_id: "agentId",
    environment_id: "environmentId",
  })
  installation!: Relation<Installation>;
  @Fk(() => PolicyVersion, {
    workspace_id: "workspaceId",
    environment_id: "environmentId",
    initial_policy_version_id: "id",
  })
  initialPolicyVersion!: Relation<PolicyVersion>;
  @Fk(() => ActionRequest, inWorkspace("retry_of_action_id"), {
    nullable: true,
  })
  retryOf!: Relation<ActionRequest> | null;
  @Fk(() => Run, inWorkspace("run_id"), { nullable: true })
  run!: Relation<Run> | null;
  @Fk(
    () => RunStep,
    { workspace_id: "workspaceId", run_id: "runId", step_key: "stepKey" },
    { nullable: true },
  )
  step!: Relation<RunStep> | null;
}

@Entity({ schema, name: "decision_permits" })
@Unique(["workspaceId", "actionRequestId"])
@Unique(["workspaceId", "id", "actionRequestId"])
export class DecisionPermit {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() actionRequestId!: string;
  @Uuid() policyVersionId!: string;
  @Uuid() credentialId!: string;
  @Clock() issuedAt!: Date;
  @Time() expiresAt!: Date;
  @Text() claimNonceDigest!: string;
  @Fk(() => ActionRequest, inWorkspace("action_request_id"))
  actionRequest!: Relation<ActionRequest>;
  @Fk(() => PolicyVersion, inWorkspace("policy_version_id"))
  policyVersion!: Relation<PolicyVersion>;
  @Fk(() => InstallationCredential, inWorkspace("credential_id"))
  credential!: Relation<InstallationCredential>;
}

@Entity({ schema, name: "client_reports" })
@Unique(["workspaceId", "installationId", "clientReportKey"])
@Index("client_reports_action", [
  "workspaceId",
  "actionRequestId",
  "receivedAt",
])
@Check("client_reports_key", `length("client_report_key") <= 128`)
@Check(
  "client_reports_outcome",
  `"outcome" IN ('success', 'failure', 'unknown')`,
)
@Check("client_reports_details", `pg_column_size("details_safe") <= 8192`)
export class ClientReport {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() installationId!: string;
  @Uuid() actionRequestId!: string;
  @OptionalUuid() permitId!: string | null;
  @Text() clientReportKey!: string;
  @Text() outcome!: "success" | "failure" | "unknown";
  @Clock() receivedAt!: Date;
  @Json("{}") detailsSafe!: object;
  @Fk(() => ActionRequest, {
    workspace_id: "workspaceId",
    action_request_id: "id",
    installation_id: "installationId",
  })
  actionRequest!: Relation<ActionRequest>;
  @Fk(
    () => DecisionPermit,
    {
      workspace_id: "workspaceId",
      permit_id: "id",
      action_request_id: "actionRequestId",
    },
    { nullable: true },
  )
  permit!: Relation<DecisionPermit> | null;
}

/** What the screens list. Seeing a permission grants nothing. */
@Entity({ schema, name: "observed_permissions" })
@Unique(["workspaceId", "installationId", "permissionFingerprint"])
@Index("observed_permissions_recent", [
  "workspaceId",
  "installationId",
  "lastSeenAt",
])
@Check("observed_tool", `length("tool_key") <= 64`)
@Check("observed_operation", `length("operation_key") <= 128`)
@Check("observed_kind", `length("resource_kind") <= 64`)
@Check("observed_label", `length("resource_label") <= 512`)
@Check("observed_attempts", `"attempt_count" > 0`)
@Check(
  "observed_outcome",
  `"last_outcome" IN ('allowed_by_rule', 'denied_by_rule', 'unknown_blocked', 'observed_only')`,
)
export class ObservedPermission {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() installationId!: string;
  @Text() permissionFingerprint!: string;
  @Text() toolKey!: string;
  @Text() operationKey!: string;
  @Text() resourceKind!: string;
  @Text() resourceLabel!: string;
  @Int({ default: 1 }) operationSchemaVersion!: number;
  @OptionalText() manifestVersion!: string | null;
  @Int({ default: 1 }) attemptCount!: number;
  @Text() lastOutcome!: string;
  @OptionalUuid() lastActionRequestId!: string | null;
  @Clock() firstSeenAt!: Date;
  @Clock() lastSeenAt!: Date;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
  @Fk(
    () => ActionRequest,
    {
      workspace_id: "workspaceId",
      last_action_request_id: "id",
      installation_id: "installationId",
    },
    { nullable: true },
  )
  lastActionRequest!: Relation<ActionRequest> | null;
}

/** Insert only for the application role. */
@Entity({ schema, name: "audit_events" })
@Index("audit_events_list", [
  "workspaceId",
  "environmentId",
  "occurredAt",
  "id",
])
@Index("audit_events_action", ["workspaceId", "actionRequestId"], {
  where: `"action_request_id" IS NOT NULL`,
})
@Index("audit_events_agent", ["workspaceId", "agentId", "occurredAt"], {
  where: `"agent_id" IS NOT NULL`,
})
@Check("audit_event_type", `length("event_type") <= 64`)
@Check("audit_actor_kind", `"actor_kind" IN ('human', 'runtime', 'system')`)
@Check("audit_decision_code", `length("decision_code") <= 64`)
@Check("audit_payload", `pg_column_size("payload_safe") <= 8192`)
@Check(
  "audit_actor",
  `("actor_kind" = 'human') = ("actor_user_id" IS NOT NULL)`,
)
export class AuditEvent {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Clock() occurredAt!: Date;
  @Text() eventType!: string;
  @Text() actorKind!: "human" | "runtime" | "system";
  @OptionalUuid() actorUserId!: string | null;
  @OptionalUuid() actorCredentialId!: string | null;
  /** The API token a person acted with, when they used one. */
  @OptionalUuid() actorTokenId!: string | null;
  @OptionalUuid() actionRequestId!: string | null;
  @OptionalUuid() agentId!: string | null;
  @OptionalUuid() environmentId!: string | null;
  @OptionalUuid() policyVersionId!: string | null;
  @OptionalUuid() matchedLogicalRuleId!: string | null;
  @Text() decisionCode!: string;
  @Uuid() @Generated("uuid") correlationId!: string;
  @Json("{}") payloadSafe!: object;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
  @Fk(() => WorkspaceMembership, member("actor_user_id"), { nullable: true })
  actorMembership!: Relation<WorkspaceMembership> | null;
  @Fk(() => InstallationCredential, inWorkspace("actor_credential_id"), {
    nullable: true,
  })
  actorCredential!: Relation<InstallationCredential> | null;
  @Fk(() => PersonalAccessToken, tokenOf("actor_token_id", "actor_user_id"), {
    nullable: true,
  })
  actorToken!: Relation<PersonalAccessToken> | null;
  @Fk(() => ActionRequest, inWorkspace("action_request_id"), { nullable: true })
  actionRequest!: Relation<ActionRequest> | null;
  @Fk(() => Agent, inWorkspace("agent_id"), { nullable: true })
  agent!: Relation<Agent> | null;
  @Fk(() => Environment, inWorkspace("environment_id"), { nullable: true })
  environment!: Relation<Environment> | null;
  @Fk(() => PolicyVersion, inWorkspace("policy_version_id"), { nullable: true })
  policyVersion!: Relation<PolicyVersion> | null;
}
