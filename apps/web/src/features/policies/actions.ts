"use server";

import { type ActionResult } from "@/components/app/action-result";
import {
  ruleInput,
  ruleProblem,
  type RuleChangeResultDto,
  type PolicyFileResultDto,
} from "@/contracts/v1/policies";
import {
  budgetInput,
  gateInput,
  type RunPolicyChange,
} from "@/contracts/v1/runs";
import type { ImpactChange, ImpactDto } from "@/contracts/v1/policy-impact";
import { readForClient, runWorkspaceAction } from "@/features/shell/load-view";
import { createRule, revokeRule, updateRule } from "@/server/modules/policies";
import { previewImpact } from "@/server/modules/policies/impact";
import { changeRunPolicy } from "@/server/modules/policies/run-policy-changes";
import type { PolicyWriteContext } from "@/server/modules/policies/repository";
import type { ErrorCode } from "@/server/db/context";
import { ruleFromForm } from "./form";

const messages: Partial<Record<ErrorCode, string>> = {
  INVALID_INPUT:
    "Choose an agent and installation available in this environment.",
  RULE_CHANGED:
    "Someone else changed this rule. Reload the page to see the latest version.",
};

function toResult(
  prefix: string,
  result: Awaited<ReturnType<typeof runWorkspaceAction<RuleChangeResultDto>>>,
): ActionResult<RuleChangeResultDto> {
  return result.status === "ok"
    ? {
        status: "ok",
        data: result.value,
        message: `${prefix}.`,
      }
    : result;
}

const ruleFieldMessages: Record<string, string> = {
  name: "Enter a rule name.",
  effect: "Choose Allow or Deny.",
  agentKey: "Choose an agent available in this environment.",
  installationName: "Choose an installation for the selected agent.",
  toolKey: "Choose a tool and operation.",
  operationKey: "Choose a tool and operation.",
  resource: "Check the resource kind, match and value.",
  conditions: "Check the rule conditions.",
  expiresAt: "Enter a valid expiry date and time.",
};

/** A rule the form can name the problem with is refused here, in words. */
function formIssue(rule: unknown): ActionResult<RuleChangeResultDto> | null {
  const parsed = ruleInput.safeParse(rule);
  const problem = parsed.success
    ? ruleProblem(parsed.data)
    : (ruleFieldMessages[String(parsed.error.issues[0]?.path[0])] ??
      "Check the rule fields.");
  return problem ? { status: "error", message: problem } : null;
}

async function submitRule(
  workspace: string,
  data: FormData,
  success: string,
  run: (
    context: PolicyWriteContext,
    rule: ReturnType<typeof ruleFromForm>,
  ) => Promise<RuleChangeResultDto>,
) {
  const rule = ruleFromForm(data);
  const issue = formIssue(rule);
  if (issue) return issue;
  const reviewed = data.get("reviewedProjectId");
  const reviewedProjectId =
    typeof reviewed === "string" && reviewed ? reviewed : null;
  return toResult(
    success,
    await runWorkspaceAction(
      workspace,
      (context) => run({ ...context, reviewedProjectId }, rule),
      messages,
    ),
  );
}

export async function createRuleAction(
  workspace: string,
  environment: string,
  _previous: ActionResult<RuleChangeResultDto>,
  data: FormData,
) {
  return submitRule(workspace, data, "Rule published", (context, rule) =>
    createRule(context, environment, rule),
  );
}

export async function updateRuleAction(
  workspace: string,
  environment: string,
  ruleId: string,
  revision: number,
  _previous: ActionResult<RuleChangeResultDto>,
  data: FormData,
) {
  return submitRule(workspace, data, "Rule updated", (context, rule) =>
    updateRule(context, environment, ruleId, revision, rule),
  );
}

export async function revokeRuleAction(
  workspace: string,
  environment: string,
  ruleId: string,
  revision: number,
  reviewedProjectId: string | null,
) {
  return toResult(
    "Rule revoked",
    await runWorkspaceAction(
      workspace,
      (context) =>
        revokeRule(
          { ...context, reviewedProjectId },
          environment,
          ruleId,
          revision,
        ),
      messages,
    ),
  );
}

/**
 * What a form's rule, gate or budget would have done in the last days, before
 * it is published. Null while the form is incomplete.
 */
export async function previewImpactAction(
  workspace: string,
  environment: string,
  change: ImpactChange,
): Promise<ImpactDto | null> {
  return readForClient(workspace, (context) =>
    previewImpact(context, environment, change),
  );
}

/** Adds, changes or removes one gate or budget from its form or its list. */
export async function changeRunPolicyAction(
  workspace: string,
  environment: string,
  change: RunPolicyChange,
  revision: number,
  reviewedProjectId: string | null,
): Promise<ActionResult<PolicyFileResultDto>> {
  const entry =
    change.entry === null
      ? { success: true as const, data: null }
      : (change.kind === "gate" ? gateInput : budgetInput).safeParse(
          change.entry,
        );
  if (!entry.success)
    return {
      status: "error",
      message: entry.error.issues.map((issue) => issue.message).join(" "),
    };
  const verb =
    change.entry === null ? "removed" : change.id ? "updated" : "added";
  const result = await runWorkspaceAction(
    workspace,
    (context) =>
      changeRunPolicy(
        { ...context, reviewedProjectId },
        environment,
        { ...change, entry: entry.data } as RunPolicyChange,
        revision,
      ),
    {
      INVALID_INPUT:
        "Check the entry fields and any referenced agents in this environment.",
      RULE_CHANGED:
        "The policies changed since you opened this page. Reload to see the latest version.",
      NOT_FOUND: "This entry is no longer in the policies. Reload the page.",
    },
  );
  if (result.status !== "ok") return result;
  if (!result.value.ok)
    return { status: "error", message: result.value.problems.join(" ") };
  return {
    status: "ok",
    data: result.value.result,
    message: `${change.kind === "gate" ? "Gate" : "Budget"} ${verb}.`,
  };
}
