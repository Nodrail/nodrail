"use client";

import {
  RepositoryPublishWarning,
  useRepositoryProject,
} from "./repository-policy";
import {
  ConfirmDialog,
  type ConfirmProps,
} from "@/components/app/confirm-dialog";
import { StatusBadge } from "@/components/app/status-badge";
import {
  effectLabels,
  operationLabel,
  resourceLabel,
  type Effect,
  type RuleDto,
} from "@/contracts/v1/policies";
import { track } from "@/components/analytics/posthog";
import { revokeRuleAction } from "../actions";
import { effectTones } from "../entry-looks";

export function EffectBadge({ effect }: { effect: Effect }) {
  return (
    <StatusBadge tone={effectTones[effect]}>{effectLabels[effect]}</StatusBadge>
  );
}

/** What a gate or budget does while it is unmet: it denies, with the reason. */
export const holdLabels = {
  deny: "Deny",
} as const;

/** A gate's or budget's effect, in the tone of the rule effect it matches. */
export function HoldBadge({ effect }: { effect: keyof typeof holdLabels }) {
  return (
    <StatusBadge tone={effectTones[effect]}>{holdLabels[effect]}</StatusBadge>
  );
}

type RevocableRule = Pick<
  RuleDto,
  | "logicalRuleId"
  | "ruleRevision"
  | "name"
  | "toolKey"
  | "operationKey"
  | "resource"
>;

/** The one confirmation before a rule is revoked, from its page or its row. */
export function revokeRuleConfirm(
  workspace: string,
  environment: string,
  rule: RevocableRule,
  reviewedProjectId: string | null,
): ConfirmProps<unknown> {
  return {
    kicker: "Revoke rule",
    title: `Revoke “${rule.name}”?`,
    confirmLabel: "Revoke rule",
    action: () =>
      revokeRuleAction(
        workspace,
        environment,
        rule.logicalRuleId,
        rule.ruleRevision,
        reviewedProjectId,
      ),
    onSuccess: () => track("rule_revoked"),
    children: (
      <>
        <p>
          {operationLabel(rule)} · {resourceLabel(rule.resource)}
        </p>
        <p>
          Revocation affects future checks. It does not undo a completed
          external action. The rule stays in history.
        </p>
        <RepositoryPublishWarning />
      </>
    ),
  };
}

export function RevokeRuleButton({
  workspace,
  environment,
  rule,
}: {
  workspace: string;
  environment: string;
  rule: RevocableRule;
}) {
  const project = useRepositoryProject();
  return (
    <ConfirmDialog
      triggerLabel="Revoke"
      {...revokeRuleConfirm(workspace, environment, rule, project?.id ?? null)}
    />
  );
}
