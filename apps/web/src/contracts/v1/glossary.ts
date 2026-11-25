/**
 * The product's words for requests and decisions. Every surface (Overview,
 * Activity, runs, agents, Insights, toasts) reads them from here, so one
 * state never has two names. A request is something an agent asked to do;
 * a rule allows or denies it, and nothing waits for a person.
 */

/** Why a call was denied when no rule matched it. */
export const NO_RULE = "No rule covers this";

/** Why a call was denied when a gate or budget wasn't met. */
export const holdLabel = (kind: "gate" | "budget", name: string) =>
  kind === "gate" ? `Denied by gate · ${name}` : `Over budget · ${name}`;

/** What happened to a request or an action. */
export const outcomeLabels = {
  allowed: "Allowed",
  denied: "Denied",
  expired: "Expired",
  held: "Stopped",
} as const;

/** Every link into Activity reads the same. */
export const VIEW_IN_ACTIVITY = "View in Activity →";

/** What Nodrail sees, said once per page instead of a hedge on every card. */
export const COVERAGE =
  "Nodrail sees and decides only calls made through a connected integration, and a decision doesn't prove an action ran.";
