export {
  condition,
  conditionOperators,
  effects,
  operationPattern,
  resourceScope,
  ruleInput,
  type Condition,
  type Effect,
  type ResourceScope,
  type RuleInput,
} from "@nodrail/sdk";

import {
  legacySubagentRuleProblem,
  ruleInput,
  type Condition,
  type Effect,
  type ResourceScope,
  type RuleInput,
} from "@nodrail/sdk";

/**
 * Why a rule can't be saved though it is well formed, or null: today, a rule
 * for starting a subagent written for an earlier engine, which would never
 * match. The engine asks the same question when it compiles a rules file.
 */
export const ruleProblem = (rule: {
  toolKey: string;
  operationKey: string;
  resource: { kind: string };
}) =>
  legacySubagentRuleProblem({
    toolKey: rule.toolKey,
    operationKey: rule.operationKey,
    resourceKind: rule.resource.kind,
  });

/** A rule as the form and API accept it: valid, and able to match. */
export const currentRuleInput = ruleInput.superRefine((rule, issues) => {
  const problem = ruleProblem(rule);
  if (problem)
    issues.addIssue({
      code: "custom",
      message: problem,
      path: ["resource", "kind"],
    });
});

export type RuleRevisionDto = {
  revision: number;
  name: string;
  summary: string;
  updatedAt: string;
  updatedBy: string;
};

export type RuleDto = RuleInput & {
  logicalRuleId: string;
  ruleRevision: number;
  status: "active" | "expired" | "revoked";
  updatedAt: string;
  updatedBy: string;
};

export type RuleDetailDto = RuleDto & {
  history: RuleRevisionDto[];
  revoked: { at: string; by: string } | null;
};

export type RuleListDto = { rules: RuleDto[]; policyRevision: number };

export type RuleChangeResultDto = {
  policyRevision: number;
  logicalRuleId: string;
};

export const effectLabels: Record<Effect, string> = {
  allow: "Allow",
  deny: "Deny",
};

export const ruleStatusLabels: Record<RuleDto["status"], string> = {
  active: "Active",
  expired: "Expired",
  revoked: "Revoked",
};

export const operationLabel = (rule: {
  toolKey: string;
  operationKey: string;
}) => `${rule.toolKey}.${rule.operationKey}`;

export function resourceLabel(scope: ResourceScope) {
  if (scope.match === "any") return `${scope.kind}=*`;
  return `${scope.kind}=${scope.value}${scope.match === "prefix" ? "*" : ""}`;
}

const operatorSymbols: Record<Condition["op"], string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "in",
  contains: "contains",
};

export function conditionLabel(item: Condition) {
  const value = Array.isArray(item.value)
    ? item.value.join(", ")
    : String(item.value);
  return `${item.field} ${operatorSymbols[item.op]} ${value}`;
}

/** One pasted or uploaded file. Keeps a form submission well under its limit. */
export const POLICY_FILE_MAX_BYTES = 256 * 1024;

/**
 * Why the live rules can't be shown as a file (`VERSION_NOT_RENDERABLE`, 409):
 * a version 4 policy isn't written back to YAML yet, and Cloud keeps
 * the compiled policy, not the file that was published.
 */
export const VERSION_NOT_RENDERABLE_MESSAGE =
  "The live rules use numeric budgets or evidence requirements (engine level 5), which Cloud can't show as a file yet. Keep the rules file you published as the source: edit it and publish it again to change them.";

export type PolicyFileIssueDto = {
  line: number;
  column: number;
  message: string;
};

export type PolicyFilePreviewDto = {
  pinsCurrent?: boolean;
  catalogRemoved?: string[];
  agentChanges?: { added: string[]; changed: string[]; removed: string[] };
  publishesPolicy?: boolean;
  workspaceLockCurrent?: boolean;
  policyCounts?: Pick<PolicyFileResultDto, "added" | "changed" | "removed">;
  takeover?: {
    projectId: string;
    hosts: { id: string; name: string }[];
  } | null;
  issues: PolicyFileIssueDto[];
  warnings: PolicyFileIssueDto[];
  /** What the preview was computed from; applying fails if either has moved on. */
  policyRevision: number;
  fileDigest: string;
  added: string[];
  changed: string[];
  removed: string[];
  unchanged: number;
};

export type PolicyFileResultDto = {
  policyRevision: number;
  added: number;
  changed: number;
  removed: number;
};
