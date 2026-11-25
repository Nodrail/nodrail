import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateRuleAction } from "@/features/policies/actions";
import {
  RuleEnvironmentNote,
  environmentName,
} from "@/features/policies/components/rule-environment";
import { SuspendedRuleForm } from "@/features/policies/components/suspended-rule-form";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { getRule } from "@/server/modules/policies";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Edit rule" };

/** Who may write rules, and whether the rule can change, are checked before anything streams. */
export default async function EditRulePage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/[rule]/edit">) {
  const { workspace, environment, rule: ruleId } = await params;
  const view = await loadWorkspaceView(workspace);
  if (!view.capabilities.includes("policies:write")) notFound();
  const rule = await readForPage(workspace, (context) =>
    getRule(context, environment, ruleId),
  );
  if (rule.status === "revoked") notFound();
  const policiesPath = appPath(workspace, environment, "policies");
  return (
    <>
      <PageHeader
        title="Edit rule"
        purpose="Change the scope explicitly. Future checks use the saved version."
        back={{ href: `${policiesPath}/${ruleId}`, label: "Back to rule" }}
      />
      <RuleEnvironmentNote
        environments={view.environments}
        environment={environment}
      />
      <SuspendedRuleForm
        label="rule editor"
        workspace={workspace}
        environment={environment}
        environmentName={environmentName(view.environments, environment)}
        action={updateRuleAction.bind(
          null,
          workspace,
          environment,
          ruleId,
          rule.ruleRevision,
        )}
        policiesPath={policiesPath}
        rule={rule}
      />
    </>
  );
}
