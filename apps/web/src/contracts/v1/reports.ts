/** The windows a report covers, in days of run activity. */
export const reportWindows = [7, 30, 90] as const;
export type ReportWindow = (typeof reportWindows)[number];

/** A URL value as a window; anything else is the default, 30 days. */
export const reportWindow = (value: string | undefined): ReportWindow =>
  reportWindows.find((days) => String(days) === value) ?? 30;

/** A count out of a total. The share is left to the page; `of` may be 0. */
export type ShareDto = { count: number; of: number };

export type GateReportDto = {
  id: string;
  name: string;
  /** Actions the gate covered. */
  checked: number;
  /** Covered actions it held back. */
  held: number;
  /** Runs whose first covered action was not held, of runs it covered. */
  firstPass: ShareDto;
  /** What held actions were missing, most often first. */
  missing: { label: string; count: number }[];
};

/** A run named in a report, linked to its timeline. */
export type ReportRunDto = { id: string; key: string };

export type BudgetReportDto = {
  id: string;
  name: string;
  /** Actions it held back. */
  hits: number;
  /** The runs those happened in. */
  runs: ReportRunDto[];
};

export type AgentReportDto = {
  agent: string;
  steps: number;
  verdicts: { verdict: string; count: number }[];
  /** Finished steps that reported no receipt. */
  withoutReceipt: number;
  /** Steps that started again after a check sent the work back. */
  backSteps: number;
  /** Accepted verdicts the same agent took back with no builder work between. */
  contradictedPasses: number;
  /** What its finished steps reported spending. */
  spend: SpendDto;
};

/** Spend as steps reported it in their receipts; absent figures count as 0. */
export type SpendDto = { usd: number; tokens: number };

/** A check a gate names (such as qa), over the runs it ran in. */
export type CheckReportDto = {
  agent: string;
  /** Runs where it finished with a verdict. */
  runs: number;
  /** Runs whose first verdict from it was accepted. */
  firstTry: number;
  /** Runs where it accepted the work at some point. */
  eventually: number;
};

export type RunSpendDto = ReportRunDto & {
  steps: number;
  /** Builder steps started after a check rejected the work. */
  reworkLoops: number;
  spend: SpendDto;
};

export type RunsReportDto = {
  count: number;
  /** Null when there are no runs. */
  medianSteps: number | null;
  /** Runs where no gate held anything, of runs that reached a gate. */
  withoutHold: ShareDto;
  /** Builder steps started after a check rejected the work, across runs. */
  reworkLoops: number;
  /** Runs with at least one such loop. */
  withRework: number;
  spend: SpendDto;
};

export type ReportDto = {
  gates: GateReportDto[];
  budgets: BudgetReportDto[];
  agents: AgentReportDto[];
  runs: RunsReportDto;
  checks: CheckReportDto[];
  /** The runs that spent most, most first; at most five. */
  topRuns: RunSpendDto[];
};
