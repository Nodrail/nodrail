import {
  conditionLabel,
  type Condition,
  type Effect,
} from "@/contracts/v1/policies";
import type { ImpactChange, ImpactDto } from "@/contracts/v1/policy-impact";
import { plural } from "@/lib/text";

// The sentences a policy form shows before it publishes: what the rule will
// do, and what the entry would have done to the last days' actions.

/** A rule as the form has it now, possibly incomplete. */
export type RuleDraft = {
  name: string;
  effect: string;
  agentKey: string | null;
  installationName: string | null;
  toolKey: string;
  operationKey: string;
  resource: { kind: string; match: string; value?: string };
  conditions: unknown;
  expiresAt: string | null;
};

function agentPhrase(draft: RuleDraft, any: string) {
  if (!draft.agentKey) return any;
  return draft.installationName
    ? `${draft.agentKey} (installation ${draft.installationName})`
    : draft.agentKey;
}

function resourcePhrase({ kind, match, value }: RuleDraft["resource"]) {
  const noun = kind || "resource";
  if (match === "any") return `any ${noun}`;
  if (!value) return `the ${noun} you name`;
  return match === "prefix" ? `any ${noun} starting with ${value}` : value;
}

function conditionsPhrase(conditions: unknown) {
  if (!Array.isArray(conditions) || !conditions.length) return "";
  return ` when ${(conditions as Condition[]).map(conditionLabel).join(" and ")}`;
}

/**
 * One sentence saying what the rule will do once published: "Allows every
 * agent to run github.issues.list on acme/support in Development, until
 * revoked." Null until a decision is chosen.
 */
export function ruleSummary(draft: RuleDraft, environmentName: string) {
  const effect = draft.effect as Effect;
  const operation = draft.toolKey
    ? [draft.toolKey, draft.operationKey].filter(Boolean).join(".")
    : "the operation";
  const scope = `${operation} on ${resourcePhrase(draft.resource)}${conditionsPhrase(draft.conditions)} in ${environmentName}`;
  const until = draft.expiresAt
    ? `until ${draft.expiresAt.slice(0, 10)}`
    : "until revoked";
  if (effect === "allow")
    return `Allows ${agentPhrase(draft, "every agent")} to run ${scope}, ${until}.`;
  if (effect === "deny")
    return `Denies ${agentPhrase(draft, "every agent")} ${scope}, ${until}.`;
  return null;
}

const decidedDifferently = (changed: number) =>
  changed
    ? `${plural(changed, "action")} would have been decided differently`
    : "none would have been decided differently";

/** What the impact preview says, for each state of the check. */
export function impactText(
  kind: ImpactChange["kind"],
  impact: ImpactDto | null,
  environmentName: string,
) {
  if (!impact)
    return "Fill in the form to see what it would have matched in the last 7 days.";
  const { days, actions, matched, changed, runs, withoutRun } = impact;
  if (!actions)
    return `No actions were recorded in ${environmentName} in the last ${days} days, so there is nothing to compare yet.`;
  const looked = impact.sampled
    ? `the latest ${plural(actions, "action")}`
    : plural(actions, "action");
  if (kind === "budget") {
    const outside = withoutRun
      ? `, and held ${withoutRun} taken outside any run`
      : "";
    return `Of ${looked} in the last ${days} days, it would have been over its limit for ${matched - withoutRun} in ${plural(runs, "run")}${outside}; ${decidedDifferently(changed)}.`;
  }
  return `Of ${looked} in the last ${days} days, it would have matched ${matched}; ${decidedDifferently(changed)}.`;
}
