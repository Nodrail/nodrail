import { notFound } from "next/navigation";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { appPath } from "@/lib/product-path";
import { loadRunPolicyAndAgents, loadSuggestions } from "../load";
import { BudgetForm } from "./budget-form";
import { GateForm } from "./gate-form";
import { RuleEnvironmentNote, environmentName } from "./rule-environment";
import { runPolicySegment } from "./run-policy-tab";

const purposes = {
  gate: "Hold an action until earlier steps of the run report the verdicts you need.",
  budget: "Cap how many tool calls, tokens or dollars a step or run may use.",
};

/**
 * A gate's or budget's form page: new without `id`, editing with it. Who may
 * write policies is checked before anything streams.
 */
export async function RunPolicyEntryPage({
  workspace,
  environment,
  kind,
  id,
}: {
  workspace: string;
  environment: string;
  kind: "gate" | "budget";
  id?: string;
}) {
  const view = await loadWorkspaceView(workspace);
  if (!view.capabilities.includes("policies:write")) notFound();
  const [{ policy, agents }, suggestions] = await Promise.all([
    loadRunPolicyAndAgents(workspace, environment),
    loadSuggestions(workspace, environment),
  ]);
  const gate = policy.gates.find((item) => item.id === id);
  const budget = policy.budgets.find((item) => item.id === id);
  if (id && !(kind === "gate" ? gate : budget)) notFound();
  const segment = runPolicySegment[kind];
  const where = {
    workspace,
    environment,
    environmentName: environmentName(view.environments, environment),
    revision: policy.revision,
    listPath: appPath(workspace, environment, `policies/${segment}`),
  };
  return (
    <>
      <PageHeader
        title={id ? `Edit ${kind}` : `Create a ${kind}`}
        purpose={
          id
            ? `Saving publishes a new policy version to ${where.environmentName}. Its next checks use it.`
            : purposes[kind]
        }
        back={{ href: where.listPath, label: `Back to ${segment}` }}
      />
      <RuleEnvironmentNote
        environments={view.environments}
        environment={environment}
      />
      {kind === "gate" ? (
        <GateForm
          where={where}
          agents={agents}
          suggestions={suggestions}
          gate={gate}
        />
      ) : (
        <BudgetForm where={where} suggestions={suggestions} budget={budget} />
      )}
    </>
  );
}
