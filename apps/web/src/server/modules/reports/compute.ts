// Reports from what Cloud stored, and nothing else. Pure: rows and the active
// version's gates in, numbers out, so a hand-counted fixture can check them.
import {
  evaluate,
  type Descriptor,
  type PolicyBudget,
  type PolicyGate,
  type Requirement,
} from "@nodrail/sdk";
import type {
  AgentReportDto,
  BudgetReportDto,
  CheckReportDto,
  GateReportDto,
  ReportDto,
  ReportRunDto,
  RunSpendDto,
  RunsReportDto,
  SpendDto,
} from "@/contracts/v1/reports";
import { requirementLabel } from "@/contracts/v1/runs";

export type ReportRun = ReportRunDto;

export type ReportStep = {
  runId: string;
  stepKey: string;
  agent: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  verdict: string | null;
  /** What the receipt said it spent, when it said. */
  usd?: number | null;
  tokens?: number | null;
};

export type ReportAction = {
  id: string;
  runId: string;
  decidedBy: "server" | "host";
  at: Date;
  /** The step's agent, or `main` outside any step. */
  agent: string;
  descriptor: Descriptor;
  /** The gate or budget that held it, as recorded when it was decided. */
  hold: {
    kind: "gate" | "budget";
    id: string;
    /** For a gate, the requirements the run had not met. */
    missing?: Requirement[];
  } | null;
};

export type ReportInput = {
  runs: ReportRun[];
  steps: ReportStep[];
  actions: ReportAction[];
  gates: PolicyGate[];
  budgets: PolicyBudget[];
};

const time = (date: Date | null) => date?.getTime() ?? Number.NaN;
const lower = (value: string | null) => value?.toLowerCase() ?? null;

/** Oldest first; ties keep the order the database gave. */
const byTime = <T>(items: T[], at: (item: T) => number) =>
  items.toSorted((a, b) => at(a) - at(b));

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}

/** Each agent a requirement names, with the verdicts and `since` agents it accepts. */
function requirementsByAgent(gates: PolicyGate[]) {
  const accepted = new Map<string, Set<string>>();
  const since = new Map<string, Set<string>>();
  for (const { agent, verdicts, since: after } of gates.flatMap(
    (gate) => gate.requires,
  )) {
    const name = agent.toLowerCase();
    const verdictSet = accepted.get(name) ?? new Set<string>();
    const sinceSet = since.get(name) ?? new Set<string>();
    for (const verdict of verdicts) verdictSet.add(verdict.toLowerCase());
    for (const other of after) sinceSet.add(other.toLowerCase());
    accepted.set(name, verdictSet);
    since.set(name, sinceSet);
  }
  return { accepted, since };
}

type Requirements = ReturnType<typeof requirementsByAgent>;

const isAccepted = (
  rules: Requirements,
  agent: string,
  verdict: string | null,
) => verdict !== null && (rules.accepted.get(agent)?.has(verdict) ?? false);

/** A gate covers an action the way it matches one when deciding. */
function covers(gate: PolicyGate, action: ReportAction) {
  if (action.hold?.kind === "gate" && action.hold.id === gate.id) return true;
  const rule = {
    logicalRuleId: gate.id,
    agentId: gate.agentKey,
    installationId: gate.installationName,
    toolKey: gate.toolKey,
    operationKey: gate.operationKey,
    effect: gate.effect,
    resource: gate.resource,
    conditions: gate.conditions,
    expiresAt: gate.expiresAt ? new Date(gate.expiresAt) : null,
  };
  return evaluate(action.descriptor, [rule], action.at).outcome !== "none";
}

const heldBy = (action: ReportAction, kind: "gate" | "budget", id: string) =>
  action.hold?.kind === kind && action.hold.id === id;

const share = (count: number, of: number) => ({ count, of });

function gateReport(gate: PolicyGate, actions: ReportAction[]): GateReportDto {
  const covered = actions.filter((action) => covers(gate, action));
  const held = covered.filter((action) => heldBy(action, "gate", gate.id));
  const firsts = [...groupBy(covered, (action) => action.runId).values()].map(
    (inRun) => byTime(inRun, (action) => time(action.at))[0],
  );
  const clean = firsts.filter(
    (action) => action && !heldBy(action, "gate", gate.id),
  );
  return {
    id: gate.id,
    name: gate.name,
    checked: covered.length,
    held: held.length,
    firstPass: share(clean.length, firsts.length),
    missing: missingCounts(held),
  };
}

/** Each requirement held actions lacked, and how often; most often first. */
function missingCounts(held: ReportAction[]) {
  const counts = new Map<string, number>();
  for (const action of held)
    for (const requirement of action.hold?.missing ?? []) {
      const label = requirementLabel(requirement);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .toSorted((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function budgetReport(
  budget: PolicyBudget,
  actions: ReportAction[],
  runs: ReportRun[],
): BudgetReportDto {
  const hits = actions.filter((action) => heldBy(action, "budget", budget.id));
  const inRuns = new Set(hits.map((action) => action.runId));
  return {
    id: budget.id,
    name: budget.name,
    hits: hits.length,
    runs: runs
      .filter((run) => inRuns.has(run.id))
      .map(({ id, key }) => ({ id, key })),
  };
}

const lastWork = (step: ReportStep) => time(step.finishedAt ?? step.startedAt);

/**
 * Started again after a check sent the work back: since this agent's previous
 * step, another agent that a requirement names finished with a verdict no
 * requirement on it accepts.
 */
function isBackStep(
  step: ReportStep,
  inRun: ReportStep[],
  rules: Requirements,
) {
  const start = time(step.startedAt);
  const previous = inRun
    .filter((other) => other.agent === step.agent && other !== step)
    .map(lastWork)
    .filter((at) => at < start);
  if (!previous.length) return false;
  const from = Math.max(...previous);
  return inRun.some(
    (other) =>
      other.agent !== step.agent &&
      rules.accepted.has(other.agent) &&
      time(other.finishedAt) > from &&
      time(other.finishedAt) < start &&
      !isAccepted(rules, other.agent, other.verdict),
  );
}

/** When anything happened in a run, by agent: steps starting, finishing, actions. */
function workTimes(steps: ReportStep[], actions: ReportAction[]) {
  return [
    ...steps.flatMap((step) => [
      { agent: step.agent, at: time(step.startedAt) },
      { agent: step.agent, at: time(step.finishedAt) },
    ]),
    ...actions.map((action) => ({ agent: action.agent, at: time(action.at) })),
  ].filter(({ at }) => Number.isFinite(at));
}

type RunRows = { steps: ReportStep[]; work: { agent: string; at: number }[] };

/**
 * An accepted verdict that a later step of the same agent contradicted, with no
 * work in between by an agent its requirements name in `since`.
 */
function isContradicted(pass: ReportStep, run: RunRows, rules: Requirements) {
  if (!isAccepted(rules, pass.agent, pass.verdict)) return false;
  const from = time(pass.finishedAt);
  const builders = rules.since.get(pass.agent) ?? new Set<string>();
  return run.steps.some((later) => {
    const to = time(later.finishedAt);
    if (later.agent !== pass.agent || !(to > from)) return false;
    if (later.verdict === null || isAccepted(rules, later.agent, later.verdict))
      return false;
    return !run.work.some(
      ({ agent, at }) => builders.has(agent) && at > from && at < to,
    );
  });
}

function verdictCounts(steps: ReportStep[]) {
  const counts = new Map<string, number>();
  for (const { verdict } of steps)
    if (verdict !== null) counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  return [...counts]
    .map(([verdict, count]) => ({ verdict, count }))
    .toSorted(
      (a, b) => b.count - a.count || a.verdict.localeCompare(b.verdict),
    );
}

function agentReports(
  steps: ReportStep[],
  actions: ReportAction[],
  rules: Requirements,
): AgentReportDto[] {
  const runs = new Map<string, RunRows>();
  const actionsByRun = groupBy(actions, (action) => action.runId);
  for (const [runId, inRun] of groupBy(steps, (step) => step.runId))
    runs.set(runId, {
      steps: inRun,
      work: workTimes(inRun, actionsByRun.get(runId) ?? []),
    });
  const runOf = (step: ReportStep) =>
    runs.get(step.runId) ?? { steps: [], work: [] };
  return [...groupBy(steps, (step) => step.agent)]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([agent, own]) => ({
      agent,
      steps: own.length,
      verdicts: verdictCounts(own),
      withoutReceipt: own.filter(
        (step) => step.finishedAt && step.verdict === null,
      ).length,
      backSteps: own.filter(
        (step) => step.startedAt && isBackStep(step, runOf(step).steps, rules),
      ).length,
      contradictedPasses: own.filter((step) =>
        isContradicted(step, runOf(step), rules),
      ).length,
      spend: spendOf(own),
    }));
}

/** Sums to the micro-unit, so adding cents never shows a float's tail. */
const tidy = (value: number) => Math.round(value * 1e6) / 1e6;

function spendOf(steps: ReportStep[]): SpendDto {
  return {
    usd: tidy(steps.reduce((sum, step) => sum + (step.usd ?? 0), 0)),
    tokens: steps.reduce((sum, step) => sum + (step.tokens ?? 0), 0),
  };
}

/** Agents a gate names as checks, and agents named in their `since`: builders. */
const buildersOf = (rules: Requirements) =>
  new Set([...rules.since.values()].flatMap((names) => [...names]));

/**
 * Builder steps that started after a check rejected the work: since the
 * previous builder step started (or the run began), a check finished with a
 * verdict no requirement on it accepts.
 */
function reworkLoops(inRun: ReportStep[], rules: Requirements) {
  const builders = buildersOf(rules);
  const failures = inRun
    .filter(
      (step) =>
        rules.accepted.has(step.agent) &&
        step.verdict !== null &&
        !isAccepted(rules, step.agent, step.verdict),
    )
    .map((step) => time(step.finishedAt));
  const starts = byTime(
    inRun.filter((step) => builders.has(step.agent) && step.startedAt),
    (step) => time(step.startedAt),
  ).map((step) => time(step.startedAt));
  return starts.filter((start, index) => {
    const from = index ? (starts[index - 1] ?? -Infinity) : -Infinity;
    return failures.some((at) => at > from && at < start);
  }).length;
}

/** Per check agent, per run: was its first verdict accepted, and any of them. */
function checkReports(
  steps: ReportStep[],
  rules: Requirements,
): CheckReportDto[] {
  const verdicts = steps.filter(
    (step) => rules.accepted.has(step.agent) && step.verdict !== null,
  );
  return [...groupBy(verdicts, (step) => step.agent)]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([agent, own]) => {
      const runs = [...groupBy(own, (step) => step.runId).values()].map(
        (inRun) =>
          byTime(inRun, (step) => time(step.finishedAt)).map((step) =>
            isAccepted(rules, agent, step.verdict),
          ),
      );
      return {
        agent,
        runs: runs.length,
        firstTry: runs.filter((accepted) => accepted[0]).length,
        eventually: runs.filter((accepted) => accepted.includes(true)).length,
      };
    });
}

function runSpends(input: ReportInput, rules: Requirements): RunSpendDto[] {
  const steps = groupBy(input.steps, (step) => step.runId);
  return input.runs.map(({ id, key }) => {
    const inRun = steps.get(id) ?? [];
    return {
      id,
      key,
      steps: inRun.length,
      reworkLoops: reworkLoops(inRun, rules),
      spend: spendOf(inRun),
    };
  });
}

const TOP_RUNS = 5;

/** The runs that spent most: USD first, then tokens; runs that spent nothing are left out. */
const topRuns = (runs: RunSpendDto[]) =>
  runs
    .filter(({ spend }) => spend.usd > 0 || spend.tokens > 0)
    .toSorted(
      (a, b) =>
        b.spend.usd - a.spend.usd ||
        b.spend.tokens - a.spend.tokens ||
        a.key.localeCompare(b.key),
    )
    .slice(0, TOP_RUNS);

function median(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return null;
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function runsReport(
  input: ReportInput,
  gateActions: ReportAction[],
  covered: (action: ReportAction) => boolean,
  spends: RunSpendDto[],
): RunsReportDto {
  const gateIds = new Set(input.gates.map((gate) => gate.id));
  const reached = new Set(
    gateActions.filter(covered).map((action) => action.runId),
  );
  const heldIn = new Set(
    gateActions
      .filter(
        (action) => action.hold?.kind === "gate" && gateIds.has(action.hold.id),
      )
      .map((action) => action.runId),
  );
  const steps = groupBy(input.steps, (step) => step.runId);
  return {
    count: input.runs.length,
    medianSteps: median(
      input.runs.map((run) => steps.get(run.id)?.length ?? 0),
    ),
    withoutHold: share(
      [...reached].filter((runId) => !heldIn.has(runId)).length,
      reached.size,
    ),
    reworkLoops: spends.reduce((sum, run) => sum + run.reworkLoops, 0),
    withRework: spends.filter((run) => run.reworkLoops > 0).length,
    spend: spendOf(input.steps),
  };
}

/** Names compare in lowercase, as the engine records them. */
function normalized(input: ReportInput): ReportInput {
  return {
    ...input,
    steps: input.steps.map((step) => ({
      ...step,
      agent: step.agent.toLowerCase(),
      verdict: lower(step.verdict),
    })),
    actions: input.actions.map((action) => ({
      ...action,
      agent: action.agent.toLowerCase(),
    })),
  };
}

/** Every number on the reports page, from one window's rows and the current rules. */
export function computeReport(raw: ReportInput): ReportDto {
  const input = normalized(raw);
  const rules = requirementsByAgent(input.gates);
  const covered = (action: ReportAction) =>
    input.gates.some((gate) => covers(gate, action));
  const spends = runSpends(input, rules);
  const gateActions = input.actions.filter(
    ({ decidedBy }) => decidedBy === "server",
  );
  return {
    gates: input.gates.map((gate) => gateReport(gate, gateActions)),
    budgets: input.budgets.map((budget) =>
      budgetReport(budget, input.actions, input.runs),
    ),
    agents: agentReports(input.steps, input.actions, rules),
    runs: runsReport(input, gateActions, covered, spends),
    checks: checkReports(input.steps, rules),
    topRuns: topRuns(spends),
  };
}
