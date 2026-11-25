import type { AgentCountsDto } from "./activity";
import type { UsageDto } from "./billing";

/** What decides between the setup guide, an empty page and the overview. */
export type OverviewStateDto = {
  /** Whether any integration here has ever reached Nodrail. */
  checkedIn: boolean;
  agents: AgentCountsDto;
  /** Whether this person can see any decision recorded here. */
  anyDecision: boolean;
};

/** The outcomes counted for today, each an Activity filter of the same name. */
export const todayOutcomes = ["allowed", "denied", "held"] as const;
export type TodayOutcome = (typeof todayOutcomes)[number];

/** How many days each trend covers, today included. */
export const TREND_DAYS = 7;

export type OutcomeTrendDto = {
  /** Events in the last 24 hours, as Activity counts them for `range=24h`. */
  count: number;
  /** One figure per 24-hour window, oldest first; the last is the last 24 hours. */
  days: number[];
};

export type TodayDto = Record<TodayOutcome, OutcomeTrendDto>;

/** This month's use of the plan: agent actions, and the free run steps. */
export type PlanUsageDto = { actions: UsageDto; steps: UsageDto };
