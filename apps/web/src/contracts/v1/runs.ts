import {
  resourceScope,
  type Requirement,
  type ResourceScope,
} from "@nodrail/policy-engine";
import { z } from "zod";
import type { BudgetStandingDto } from "./budgets";
import type { ContractEventDto } from "./contract-events";
import type { ContractCheckDto } from "./contract-explain";
import { outcomeLabels } from "./glossary";

/** What held an action back: a gate still missing steps, or a used-up budget. */
export type RunHoldDto = {
  kind: "gate" | "budget";
  /** The gate's or budget's id in the policy version that decided. */
  id: string;
  name: string;
  explanation: string;
  /** For a gate, the requirements the run had not met. Empty for a budget. */
  missing: Requirement[];
  /**
   * For a gate, every requirement as the run stood when it held the action:
   * met or not, and what its agent last reported. Absent on holds recorded
   * before Nodrail kept it, and for a budget.
   */
  requirements?: RequirementStatusDto[];
  /**
   * For a numeric budget (document version 4): where it stood for this
   * call, with the label its source gives it ("3 of 3 calls used ·
   * Enforced allowance").
   */
  limit?: BudgetStandingDto;
};

/** One requirement of a gate, as the run stood when the gate decided. */
export type RequirementStatusDto = Requirement & {
  met: boolean;
  /** The agent's latest finished step in the run, if it finished one. */
  reported: { verdict: string | null; at: string } | null;
  /**
   * For a requirement on a declared receipt (C01): the path-level reason,
   * as `explainRequirement` gave it when the gate decided. Named apart from
   * the requirement's own `contract` (the digest it pins).
   */
  check?: ContractCheckDto;
};

/** Waiting for a person, held by a gate or budget, a step working, or quiet. */
export type RunStatus = "held" | "running" | "idle";

/** One step agent in a run: its steps, and the verdict of its latest one. */
export type RunAgentDto = {
  agent: string;
  steps: number;
  verdict: string | null;
  finished: boolean;
};

export type RunSummaryDto = {
  id: string;
  key: string;
  /** The installation that declared the run; its key is unique only within it. */
  installationName: string;
  /** Its Nodrail agent; null when this person may not see the agent. */
  agentKey: string | null;
  createdAt: string;
  lastActivityAt: string;
  steps: number;
  actions: number;
  /** Actions held by a gate or budget. */
  held: number;
  /** Step agents in the order they first started. */
  agents: RunAgentDto[];
  /**
   * The gate or budget holding the run's latest action, unless a person
   * allowed it, and for a gate the requirements still missing.
   */
  holding: Pick<RunHoldDto, "kind" | "name" | "missing"> | null;
  status: RunStatus;
};

export type RunStepDto = {
  stepKey: string;
  agent: string;
  installationName: string;
  startedAt: string | null;
  finishedAt: string | null;
  verdict: string | null;
  findings: string[];
  /**
   * In a run's detail: the step's briefs (and inputs or results not bound
   * to an action), as Cloud validated them. Projection only.
   */
  exchanges?: ContractEventDto[];
};

export type RunActionDto = {
  id: string;
  at: string;
  stepKey: string | null;
  agent: string;
  toolKey: string;
  operationKey: string;
  resource: string;
  evaluation: "ready" | "denied";
  pauseDenial?: string;
  hold: RunHoldDto | null;
  /** Its event in Activity, once anything about it is recorded there. */
  eventId: string | null;
  /**
   * In a run's detail: the action's input and result as Cloud validated
   * them, bound by its digest. Projection only; a result's execution is
   * apart from whether it conformed.
   */
  exchanges?: ContractEventDto[];
  /** Set only when the hook decided it on its host. */
  host?: DecidedOnHostDto;
};

/** On a call the hook decided on its host: the policy file it decided with. */
export type DecidedOnHostDto = {
  policyDigest: string | null;
  policySkew: boolean | null;
};

/** On screen: a policy digest's first 12 hex characters. */
export const shortDigest = (digest: string) => digest.slice(0, 12);

/** Who decided a recorded call, as its row says: what a screen shows. */
export const decidedOnHost = (row: {
  decided_on_host: boolean | null;
  policy_digest: string | null;
  policy_skew: boolean | null;
}): { host?: DecidedOnHostDto } =>
  row.decided_on_host
    ? { host: { policyDigest: row.policy_digest, policySkew: row.policy_skew } }
    : {};

/** One timeline, oldest first: a step starting or finishing, or an action. */
export type RunEntryDto =
  | { kind: "started" | "finished"; at: string; step: RunStepDto }
  | { kind: "action"; at: string; action: RunActionDto };

export type RunDetailDto = RunSummaryDto & { timeline: RunEntryDto[] };

export type RunListDto = { runs: RunSummaryDto[]; nextCursor: string | null };

/**
 * How a requirement reads on screen: "qa must report pass after the latest
 * change and after any dev or infra step".
 */
export function requirementLabel({ agent, verdicts, since }: Requirement) {
  const after = since.length
    ? ` after the latest change and after any ${since.join(" or ")} step`
    : "";
  return `${agent} must report ${verdicts.join(" or ")}${after}`;
}

/** How one requirement stood: met, reported something else, or silent. */
export type RequirementState = "met" | "unmet" | "silent";

export function requirementState(
  status: RequirementStatusDto,
): RequirementState {
  if (status.met) return "met";
  return status.reported ? "unmet" : "silent";
}

/**
 * One requirement's status line: "qa reported fail (needs pass)", "reviewer
 * hasn't reported (needs ship)", "qa reported pass". A verdict the gate
 * accepts that still doesn't meet it came before the latest change.
 */
export function requirementStatusText(status: RequirementStatusDto) {
  const { agent, verdicts, reported, met } = status;
  const needs = `needs ${verdicts.join(" or ")}`;
  if (!reported) return `${agent} hasn't reported (${needs})`;
  const said = reported.verdict
    ? `${agent} reported ${reported.verdict}`
    : `${agent} finished without a verdict`;
  if (met) return said;
  if (reported.verdict && verdicts.includes(reported.verdict))
    return `${said} before the latest change (${needs} again)`;
  return `${said} (${needs})`;
}

/** "Denied: 2 of 2 requirements unmet"; older holds don't know the total. */
export function holdSummary(
  hold: Pick<RunHoldDto, "missing" | "requirements">,
) {
  const unmet = hold.missing.length;
  const total = hold.requirements?.length;
  const noun = (total ?? unmet) === 1 ? "requirement" : "requirements";
  return total
    ? `Denied: ${unmet} of ${total} ${noun} unmet`
    : `Denied: ${unmet} ${noun} unmet`;
}

/** An action as decided: allowed, or denied with its reason. */
export const evaluationLabels: Record<RunActionDto["evaluation"], string> = {
  ready: outcomeLabels.allowed,
  denied: outcomeLabels.denied,
};

/** A gate as the policy page lists it and its form edits it. */
export type GateDto = {
  id: string;
  name: string;
  toolKey: string;
  operationKey: string;
  resource: ResourceScope;
  agentKey: string | null;
  requires: Requirement[];
  effect: "deny";
};

export type BudgetDto = {
  id: string;
  name: string;
  agent: string | null;
  per: "step" | "run";
  metric: "tool_calls" | "tokens" | "usd";
  limit: number;
  warnAt: number | null;
  effect: "deny";
};

export type RunPolicyDto = {
  gates: GateDto[];
  budgets: BudgetDto[];
  /** The live version; a change made from this page is refused once it moves on. */
  revision: number;
};

// What the gate and budget forms send. The server also compiles the whole
// file they produce, so these only name problems early and in plain words.
const runName = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/, {
    message:
      "Step agent names use lowercase letters, digits, - and _, such as qa.",
  });
const verdict = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, {
    message: "Verdicts use lowercase letters, digits, - and _, such as pass.",
  });
/** An unmet gate or a used-up budget denies the call with its reason. */
const holdEffect = z.literal("deny");

export const gateInput = z.strictObject({
  name: z.string().trim().min(1, { message: "Name the gate." }).max(120),
  agentKey: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .nullable(),
  toolKey: z.string().regex(/^[a-z0-9_-]{1,64}$/, {
    message: "Write the operation as tool.operation, such as github.pr.create.",
  }),
  operationKey: z.string().regex(/^[a-z0-9_.-]{1,128}$/, {
    message: "Write the operation as tool.operation, such as github.pr.create.",
  }),
  resource: resourceScope,
  requires: z
    .array(
      z.strictObject({
        agent: runName,
        verdicts: z
          .array(verdict)
          .min(1, { message: "Each requirement needs a verdict." })
          .max(20),
        since: z.array(runName).max(50),
      }),
    )
    .min(1, { message: "Add at least one requirement." })
    .max(20),
  effect: holdEffect,
});
export type GateInput = z.infer<typeof gateInput>;

export const budgetInput = z
  .strictObject({
    name: z.string().trim().min(1, { message: "Name the budget." }).max(120),
    agent: runName.nullable(),
    per: z.enum(["step", "run"]),
    metric: z.enum(["tool_calls", "tokens", "usd"]),
    limit: z
      .number({ message: "Set a limit." })
      .positive({ message: "The limit must be above 0." })
      .max(1e12),
    warnAt: z
      .number()
      .positive({ message: "Warn at a number above 0." })
      .nullable(),
    effect: holdEffect,
  })
  .refine((budget) => budget.warnAt === null || budget.warnAt < budget.limit, {
    path: ["warnAt"],
    message: "Warn below the limit.",
  })
  .refine(
    (budget) =>
      budget.metric !== "tool_calls" || Number.isInteger(budget.limit),
    { path: ["limit"], message: "A tool call limit is a whole number." },
  )
  .refine((budget) => budget.per === "run" || budget.metric === "tool_calls", {
    path: ["per"],
    message:
      "Tokens and USD are known only when a step ends, so limit them per run.",
  })
  .refine((budget) => budget.per === "step" || budget.agent === null, {
    path: ["agent"],
    message: "A run budget counts every agent; leave the step agent empty.",
  });
export type BudgetInput = z.infer<typeof budgetInput>;

/** A gate or budget to add (no id), change (id), or remove (id, no entry). */
export type RunPolicyChange =
  | { kind: "gate"; id: string | null; entry: GateInput | null }
  | { kind: "budget"; id: string | null; entry: BudgetInput | null };

export const metricLabels: Record<BudgetDto["metric"], string> = {
  tool_calls: "Tool calls",
  tokens: "Tokens",
  usd: "Spend (USD)",
};
