import type { Tone } from "@/components/app/tones";
import type {
  AgentAccessDto,
  ObservedOutcome,
  Reporting,
} from "@/contracts/v1/agents";
import { NO_RULE } from "@/contracts/v1/glossary";
import { timeAgo } from "@/lib/time";

export const accessBadge = {
  active: { tone: "success", label: "Active" },
  paused: { tone: "neutral", label: "Paused" },
} as const satisfies Record<string, { tone: Tone; label: string }>;

export const reportingBadge = {
  reporting: { tone: "success", label: "Reporting" },
  stale: { tone: "warning", label: "Stale" },
  never_reported: { tone: "neutral", label: "Waiting for first check-in" },
} as const satisfies Record<Reporting, { tone: Tone; label: string }>;

/**
 * How an agent stands, in one badge: Paused when a person paused it, and
 * otherwise whether its integration reports. Being allowed to act says
 * nothing about whether it ever checked in, so "Active" is never shown.
 */
export const agentBadge = (
  access: AgentAccessDto["status"],
  reporting: Reporting,
) => (access === "paused" ? accessBadge.paused : reportingBadge[reporting]);

export const outcomeLabels: Record<ObservedOutcome, string> = {
  allowed_by_rule: "Allowed by rule",
  denied_by_rule: "Denied by rule",
  unknown_blocked: `Denied · ${NO_RULE.toLowerCase()}`,
  observed_only: "Observed",
};

const toolNames: Record<string, string> = {
  github: "GitHub",
  linear: "Linear",
  notion: "Notion",
  postgres: "Postgres",
  slack: "Slack",
  stripe: "Stripe",
};

export const toolLabels = (tools: string[]) =>
  tools.map((tool) => toolNames[tool] ?? tool);

/** The value beside a "Last check-in" label. */
export function lastCheckIn(lastSeenAt: string | null) {
  return lastSeenAt ? timeAgo(lastSeenAt) : "None yet";
}

/** "Last check-in 3 min ago", or "No check-in yet", on its own. */
export function checkInSummary(lastSeenAt: string | null) {
  return lastSeenAt
    ? `Last check-in ${timeAgo(lastSeenAt)}`
    : "No check-in yet";
}

const avatarTones = ["mint", "blue", "peach", "lilac"] as const;

/** The same agent keeps the same colour everywhere. */
export function avatarTone(key: string) {
  let hash = 0;
  for (const char of key) hash = (hash + char.charCodeAt(0)) % 997;
  return avatarTones[hash % avatarTones.length];
}

/** Enrollment supplies a project name for agents declared in a repository. */
export function agentProject(agent: {
  key: string;
  projectName?: string | null;
  project?: string | null;
}) {
  return agent.project ? `from ${agent.projectName ?? agent.project}` : null;
}
