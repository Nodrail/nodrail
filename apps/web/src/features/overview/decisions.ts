import type { ActivityEventDto } from "@/contracts/v1/activity";
import { plural } from "@/lib/text";

/** Decisions in a row with the same agent, outcome and reason, newest first. */
export type DecisionGroup = { id: string; events: ActivityEventDto[] };

/** How many rows Recent decisions shows, a group counting as one. */
export const RECENT_ROWS = 5;

const agentName = (event: ActivityEventDto) =>
  event.agentKey ?? "an agent not assigned to you";

type Words = { verb: string; reason: string };

const ruleName = (event: ActivityEventDto) =>
  event.rule?.name ?? "you can't see";

/** A rule denied it, or a gate or budget held it. */
function deniedByRule(event: ActivityEventDto): Words {
  const name = ruleName(event);
  if (event.rule?.kind === "gate")
    return { verb: "held", reason: `gate ${name}` };
  if (event.rule?.kind === "budget")
    return { verb: "held", reason: `over budget · ${name}` };
  return { verb: "denied", reason: `rule ${name}` };
}

const wordsFor: Partial<Record<string, (event: ActivityEventDto) => Words>> = {
  allowed_by_rule: (event) => ({
    verb: "allowed",
    reason: `rule ${ruleName(event)}`,
  }),
  denied_by_rule: deniedByRule,
  denied_agent_paused: (event) => ({
    verb: "denied",
    reason: `${agentName(event)} is paused`,
  }),
  denied_no_rule: () => ({ verb: "denied", reason: "no rule covers it" }),
};

/**
 * What happened, as a verb, and why, as a phrase: "denied" and "docs-helper is
 * paused". A group reads "5 actions denied — docs-helper is paused".
 */
export function decisionWords(event: ActivityEventDto): Words {
  return (
    wordsFor[event.code]?.(event) ?? {
      verb: event.label.toLowerCase(),
      reason: "",
    }
  );
}

const joined = ({ verb, reason }: Words) =>
  reason ? `${verb} — ${reason}` : verb;

/** One decision's line under its action: "Denied — docs-helper is paused". */
export function decisionSentence(event: ActivityEventDto) {
  const text = joined(decisionWords(event));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A group's title: "5 actions denied — docs-helper is paused". */
export function groupTitle(group: DecisionGroup) {
  const [first] = group.events;
  if (!first) return "";
  return `${plural(group.events.length, "action")} ${joined(decisionWords(first))}`;
}

const groupKey = (event: ActivityEventDto) => {
  const { verb, reason } = decisionWords(event);
  return [event.agentKey ?? "", event.code, verb, reason].join("\u0000");
};

/**
 * Collapses runs of the same decision (same agent, outcome and reason) into
 * one group each, keeping order, and keeps the first `limit` groups.
 */
export function groupDecisions(
  events: ActivityEventDto[],
  limit = RECENT_ROWS,
): DecisionGroup[] {
  const groups: (DecisionGroup & { key: string })[] = [];
  for (const event of events) {
    const key = groupKey(event);
    const last = groups.at(-1);
    if (last?.key === key) last.events.push(event);
    else {
      if (groups.length === limit) break;
      groups.push({ id: event.id, key, events: [event] });
    }
  }
  return groups.map(({ id, events: grouped }) => ({ id, events: grouped }));
}
