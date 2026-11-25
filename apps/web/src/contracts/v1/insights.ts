import type { RuleDto } from "./policies";
import type { ShareDto } from "./reports";

/** Every action in the window, by what the rules decided. */
export type DecisionMetricsDto = {
  actions: number;
  allowed: number;
  denied: number;
  /** Denied because no rule covered them: where a rule may be missing. */
  noRule: number;
};

export type RuleUsageDto = Pick<
  RuleDto,
  "logicalRuleId" | "name" | "effect"
> & {
  matches: number;
  lastMatchedAt: string | null;
};

export type RuleMetricsDto = {
  /** Rules that decided most in the window, most first. */
  top: RuleUsageDto[];
  /** Active rules older than the window that decided nothing in it. */
  unused: RuleUsageDto[];
  /** Active rules too new to have had the whole window. */
  newer: number;
  activeRules: number;
  decided: ShareDto;
};
