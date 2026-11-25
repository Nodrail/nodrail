import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createRuleAction } from "@/features/policies/actions";
import {
  RuleEnvironmentNote,
  environmentName,
} from "@/features/policies/components/rule-environment";
import { SuspendedRuleForm } from "@/features/policies/components/suspended-rule-form";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { firstParam } from "@/lib/search-params";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "New rule" };

/** Who may write rules is checked before anything streams. */
export default async function NewRulePage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/policies/new">) {
  const { workspace, environment } = await params;
  const { agent } = await searchParams;
  const view = await loadWorkspaceView(workspace);
  if (!view.capabilities.includes("policies:write")) notFound();
  const policiesPath = appPath(workspace, environment, "policies");
  return (
    <>
      <PageHeader
        title="Create a scoped rule"
        purpose="Choose the agent, installation and operation this rule should cover."
        back={{ href: policiesPath, label: "Back to policies" }}
      />
      <RuleEnvironmentNote
        environments={view.environments}
        environment={environment}
      />
      <SuspendedRuleForm
        label="new rule"
        workspace={workspace}
        environment={environment}
        environmentName={environmentName(view.environments, environment)}
        action={createRuleAction.bind(null, workspace, environment)}
        policiesPath={policiesPath}
        initialAgent={firstParam(agent) ?? ""}
      />
    </>
  );
}
