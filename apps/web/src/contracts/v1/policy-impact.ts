// What the policy forms show before they publish, and what the lists show
// beside each entry: computed on the server from what was recorded.

/** How far back the impact preview and budget usage look. */
export const IMPACT_DAYS = 7;

/** How far back a rule's "Last matched" looks. */
export const LAST_MATCHED_DAYS = 90;

/** One rule, gate or budget as its form has it now; id when editing. */
export type ImpactChange = {
  kind: "rule" | "gate" | "budget";
  id: string | null;
  /** The form's fields as an entry; the server validates it. */
  entry: unknown;
};

/** What an entry would have done to the window's actions. */
export type ImpactDto = {
  days: number;
  /** Actions looked at: the latest of the window, up to a limit. */
  actions: number;
  /** The window had more actions than were looked at. */
  sampled: boolean;
  /**
   * Rule or gate: the actions it covers. Budget: the actions it would have
   * found over its limit.
   */
  matched: number;
  /** Actions that would have been decided differently than by the live policies. */
  changed: number;
  /** Budget only: the runs that would have gone over it. */
  runs: number;
  /**
   * Budget only: matched actions taken outside any run. A budget that covers
   * them holds them, as it has no run to count in.
   */
  withoutRun: number;
};

/** Names recorded in this environment, offered while typing a policy. */
export type PolicySuggestionsDto = {
  /** "tool.operation", most used first. */
  operations: string[];
  /** Resource types, most used first, each with its most used values. */
  resources: { kind: string; values: string[] }[];
  /** Step agents that reported in runs. */
  stepAgents: string[];
  /** Verdicts step agents reported. */
  verdicts: string[];
};

export const emptySuggestions: PolicySuggestionsDto = {
  operations: [],
  resources: [],
  stepAgents: [],
  verdicts: [],
};

/** A budget over the window: how high it got, in how many runs, and holds. */
export type BudgetUsageDto = {
  /** The most it had counted when an action was checked; null with no runs. */
  peak: number | null;
  /** Runs it counted in. */
  runs: number;
  /** Runs it held at least once. */
  held: number;
};
