import type { DecidedOnHostDto } from "./runs";

/** An event's outcome, as listed. Filters are in `activity-query.ts`. */
export type ActivityOutcome = "allowed" | "denied" | "informational";

type Entry = {
  group: "decision" | "change";
  outcome: ActivityOutcome;
  label: string;
};

const decision = (outcome: ActivityOutcome, label: string): Entry => ({
  group: "decision",
  outcome,
  label,
});
const change = (label: string): Entry => ({
  group: "change",
  outcome: "informational",
  label,
});

/** Every audited code. Recording an unlisted one does not compile. */
export const lateHostReport = "reported late (unverified)";

export const activityCatalog = {
  host_reported_late: change(lateHostReport),
  allowed_by_rule: decision("allowed", "Allowed by rule"),
  would_deny: decision("allowed", "Would deny"),
  denied_by_rule: decision("denied", "Denied by rule"),
  denied_agent_paused: decision("denied", "Denied · agent paused"),
  // No rule covers the call: denied, so a person can add a rule if it should run.
  denied_no_rule: decision("denied", "Denied · no rule covers it"),
  rule_create: change("Rule created"),
  rule_update: change("Rule updated"),
  rule_revoke: change("Rule revoked"),
  rules_applied: change("Rules applied from YAML"),
  agent_connected: change("Agent registered"),
  agent_paused: change("Agent paused"),
  agent_resumed: change("Agent resumed"),
  credential_rotated: change("Credential rotated"),
  credential_revoked: change("Credential revoked"),
  workspace_created: change("Workspace created"),
  workspace_updated: change("Workspace settings changed"),
  billing_plan_changed: change("Plan changed"),
  workspace_archived: change("Workspace archived"),
  member_invited: change("Teammate invited"),
  invite_revoked: change("Invite revoked"),
  invite_accepted: change("Teammate joined"),
  member_role_changed: change("Role changed"),
  member_removed: change("Teammate removed"),
  ownership_transferred: change("Ownership transferred"),
  agent_assigned: change("Agent assigned"),
  agent_unassigned: change("Agent unassigned"),
  activity_exported: change("Activity exported"),
  api_token_created: change("API token created"),
  api_token_revoked: change("API token revoked"),
  workspace_revision_published: change("Intended revision published"),
  verifier_created: change("Evidence verifier added"),
  verifier_revoked: change("Evidence verifier revoked"),
  budget_reconciled: change("Budget reservation reconciled"),
} as const satisfies Record<string, Entry>;

export type DecisionCode = keyof typeof activityCatalog;

const unlisted = change("Recorded event");

export function describeActivity(code: string): Entry {
  return (activityCatalog as Record<string, Entry>)[code] ?? unlisted;
}

export type ActivityActionDto = {
  toolKey: string;
  operationKey: string;
  resourceKind: string;
  resource: string;
  installationName: string;
  /** The run the action was part of, if any. */
  run: { id: string; key: string } | null;
  reference: string;
};

export type ClientReportOutcome = "success" | "failure" | "unknown";

export type ActivityEventDto = {
  id: string;
  occurredAt: string;
  code: string;
  group: Entry["group"];
  outcome: ActivityOutcome;
  label: string;
  actor: {
    kind: "human" | "runtime" | "system";
    name: string | null;
    /** The API token the person acted with, when they used one. */
    via?: string;
  };
  /** Null when this person may no longer see the agent or its action. */
  agentKey: string | null;
  action: ActivityActionDto | null;
  /** Null for changes that apply to the agent or workspace as a whole. */
  environment: string | null;
  /** What decided: a rule, or the gate or budget that held the action. */
  rule: {
    kind: "rule" | "gate" | "budget";
    id: string;
    name: string | null;
    revision: number | null;
  } | null;
  /** Who or what a team change was about, and how it changed. */
  subject: string | null;
  detail: string | null;
  latestReport: {
    outcome: ClientReportOutcome;
    receivedAt: string;
    /**
     * The integration reported the action ran (success or failure) though
     * Nodrail never recorded a decision allowing it: the action may have
     * gone around Nodrail.
     */
    mismatch: boolean;
  } | null;
  /** Set only when the hook decided the action on its host. */
  host?: DecidedOnHostDto;
};

export type ActivityPageDto = {
  items: ActivityEventDto[];
  nextCursor: string | null;
};

export type ClientReportDto = {
  id: string;
  outcome: ClientReportOutcome;
  receivedAt: string;
  /** Whether it names a one-time permit. It still proves nothing ran. */
  linkedToPermit: boolean;
  /** As sent by the integration. Untrusted: always render as plain text. */
  details: Record<string, unknown>;
};

export type ActivityDetailDto = ActivityEventDto & {
  /** As captured from the agent. Untrusted: always render as plain text. */
  parameters: Record<string, unknown> | null;
  reports: ClientReportDto[];
};

export type AgentCountsDto = {
  /** Connected installations in this environment. */
  connected: number;
  /** Connected installations with a recent check-in. */
  reporting: number;
  /** Visible agent and machine identities whose own access is paused. */
  paused: number;
};
