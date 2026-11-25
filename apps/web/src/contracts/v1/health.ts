import type { AgentCountsDto } from "./activity";

/**
 * A step counts as stalled when it started, has not finished, and nothing has
 * happened in its run (no step event, no action) for this long.
 */
export const STALLED_STEP_MINUTES = 60;

/** How far back an installation's actions are read to judge rule coverage. */
export const COVERAGE_WINDOW_DAYS = 7;

/**
 * An installation is uncovered when, over the window, it asked at least this
 * many times and more than half of those actions matched no rule (they were
 * blocked as an unknown permission and needed a person). Fewer actions than
 * this say too little to call it either way.
 */
export const COVERAGE_MIN_ACTIONS = 3;

/** Most items any one health list returns, the most recent first. */
export const HEALTH_LIST_LIMIT = 50;

/** An installation that has not checked in within the reporting window. */
export type SilentInstallationDto = {
  agentKey: string;
  installationName: string;
  /** Null when it has never reached Nodrail. */
  lastSeenAt: string | null;
};

export type PausedAgentDto = {
  agentKey: string;
  pausedAt: string | null;
  pausedBy: string | null;
};

/** A step started and still open, in a run quiet for longer than the threshold. */
export type StalledStepDto = {
  runId: string;
  runKey: string;
  stepKey: string;
  /** The step agent, such as dev or qa; not the Nodrail agent. */
  stepAgent: string;
  /** When the step started. */
  since: string;
  /** The run's last step event or action. */
  lastActivityAt: string;
};

/** An installation whose recent actions mostly matched no rule. */
export type UncoveredInstallationDto = {
  agentKey: string;
  installationName: string;
  /** Actions in the coverage window. */
  actions: number;
  /** Of those, the ones no rule matched. */
  uncovered: number;
};

/**
 * An action the integration reported as run (success or failure) in the
 * coverage window, though Nodrail never allowed it.
 */
export type MismatchedReportDto = {
  agentKey: string;
  toolKey: string;
  operationKey: string;
  /** The latest such report. */
  reportedAt: string;
};

/** What is wrong in an environment right now, for this person. */
export type HealthDto = {
  agents: AgentCountsDto;
  silent: SilentInstallationDto[];
  paused: PausedAgentDto[];
  stalledSteps: StalledStepDto[];
  uncovered: UncoveredInstallationDto[];
  mismatched: MismatchedReportDto[];
};

/**
 * Problems to fix: silent installations, stalled steps, installations no rule
 * covers, and reports of actions Nodrail never allowed. A paused agent was
 * paused on purpose, so it is not one.
 */
export const problemCount = (health: HealthDto) =>
  health.silent.length +
  health.stalledSteps.length +
  health.uncovered.length +
  health.mismatched.length;
