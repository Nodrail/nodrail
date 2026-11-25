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
import type { ErrorCode } from "@/server/db/context";
import { ruleFromForm } from "./form";

const messages: Partial<Record<ErrorCode, string>> = {
  INVALID_INPUT:
    "Check the operation, resource and conditions, then try again.",
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

/** A rule the form can name the problem with is refused here, in words. */
function formIssue(rule: unknown): ActionResult<RuleChangeResultDto> | null {
  const parsed = ruleInput.safeParse(rule);
  const problem = parsed.success ? ruleProblem(parsed.data) : null;
  return problem ? { status: "error", message: problem } : null;
}

export async function createRuleAction(
  workspace: string,
  environment: string,
  _previous: ActionResult<RuleChangeResultDto>,
  data: FormData,
) {
  const rule = ruleFromForm(data);
  return (
    formIssue(rule) ??
    toResult(
      "Rule published",
      await runWorkspaceAction(
        workspace,
        (context) => createRule(context, environment, rule),
        messages,
      ),
    )
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
  const rule = ruleFromForm(data);
  return (
    formIssue(rule) ??
    toResult(
      "Rule updated",
      await runWorkspaceAction(
        workspace,
        (context) => updateRule(context, environment, ruleId, revision, rule),
        messages,
      ),
    )
  );
}

export async function revokeRuleAction(
  workspace: string,
  environment: string,
  ruleId: string,
  revision: number,
) {
  return toResult(
    "Rule revoked",
    await runWorkspaceAction(
      workspace,
      (context) => revokeRule(context, environment, ruleId, revision),
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
        context,
        environment,
        { ...change, entry: entry.data } as RunPolicyChange,
        revision,
      ),
    {
      ...messages,
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
