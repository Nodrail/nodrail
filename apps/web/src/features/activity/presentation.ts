import type { Tone } from "@/components/app/tones";
import type {
  ActivityEventDto,
  ActivityOutcome,
  ClientReportOutcome,
} from "@/contracts/v1/activity";
import { operationLabel } from "@/contracts/v1/policies";

export const outcomeTones: Record<ActivityOutcome, Tone> = {
  allowed: "success",
  denied: "danger",
  informational: "neutral",
};

export const ruleLabels = {
  rule: "Rule",
  gate: "Gate",
  budget: "Budget",
} as const;

export const reportLabels: Record<ClientReportOutcome, string> = {
  success: "Client reported success",
  failure: "Client reported failure",
  unknown: "Client reported an unknown result",
};

/** A report that says an action ran which Nodrail never allowed. */
export const mismatchLabel = "Report doesn't match decision";
export const mismatchText =
  "Your integration reported that this action ran, but Nodrail never allowed it: no rule allowed it and no permit was issued. The action may have gone around Nodrail. Check how this agent's integration is set up.";

export function actorLabel({ actor }: ActivityEventDto) {
  if (actor.kind === "human") {
    const person = actor.name ?? "A former member";
    return actor.via ? `${person} via API token ${actor.via}` : person;
  }
  if (actor.kind === "runtime") return "Agent integration";
  return "Nodrail policy engine";
}

/** What happened to what. A hidden agent is named as hidden, never guessed. */
export function eventTitle(event: ActivityEventDto) {
  if (event.action) return operationLabel(event.action);
  if (event.group === "decision")
    return "A request on an agent not assigned to you";
  if (event.subject) return event.subject;
  if (event.rule) return event.rule.name ?? "A rule you can't see";
  if (event.code === "workspace_created") return "Workspace";
  return event.agentKey ?? "An agent not assigned to you";
}

const explanations: Partial<Record<string, string>> = {
  allowed_by_rule: "Nodrail recorded an allow decision for this covered call.",
  denied_by_rule:
    "Nodrail recorded a deny. The configured integration should keep this covered call blocked.",
  denied_no_rule:
    "No rule covers this call, so Nodrail denied it. Add a rule that allows it if the agent should be able to make it.",
};

export function explainEvent(event: ActivityEventDto) {
  return explanations[event.code] ?? null;
}
