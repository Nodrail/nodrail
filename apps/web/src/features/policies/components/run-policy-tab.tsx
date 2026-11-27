import { docsUrl } from "@/features/guidance/docs-url";
import { EmptyState } from "@/components/app/card";
import { Button } from "@/components/ui/button";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { appPath } from "@/lib/product-path";
import { budgetUsage } from "@/server/modules/policies/usage";
import { activeRunPolicy } from "@/server/modules/runs/policy";
import { PoliciesHeader } from "./policies-header";
import { BudgetList, GateList } from "./run-policy-list";

/** Where a kind lives under Policies: its tab and its forms. */
export const runPolicySegment = { gate: "gates", budget: "budgets" } as const;

const empty = {
  gate: {
    title: "No gates yet",
    body: "A gate holds an action until earlier steps of the run pass, such as QA before a pull request. It is saved in the rules file, so the YAML tab shows it too.",
  },
  budget: {
    title: "No budgets yet",
    body: "A budget caps how many tool calls, tokens or dollars a step or run may use. It is saved in the rules file, so the YAML tab shows it too.",
  },
};

/** The Gates or the Budgets tab of Policies: one list, one kind. */
export async function RunPolicyTab({
  workspace,
  environment,
  kind,
}: {
  workspace: string;
  environment: string;
  kind: "gate" | "budget";
}) {
  const view = await loadWorkspaceView(workspace);
  const { policy, usage } = await readForPage(workspace, async (context) => ({
    policy: await activeRunPolicy(context, environment),
    usage: kind === "budget" ? await budgetUsage(context, environment) : {},
  }));
  const where = {
    workspace,
    environment,
    revision: policy.revision,
    listPath: appPath(
      workspace,
      environment,
      `policies/${runPolicySegment[kind]}`,
    ),
    canManage: view.capabilities.includes("policies:write"),
  };
  const none = kind === "gate" ? !policy.gates.length : !policy.budgets.length;
  return (
    <>
      <PoliciesHeader
        workspace={workspace}
        environment={environment}
        environments={view.environments}
        canManage={where.canManage}
        current={runPolicySegment[kind]}
      />
      {none ? (
        <EmptyState
          title={empty[kind].title}
          action={
            <Button asChild variant="outline">
              <a href={docsUrl("runs")}>How runs work</a>
            </Button>
          }
        >
          {empty[kind].body}
        </EmptyState>
      ) : kind === "gate" ? (
        <GateList gates={policy.gates} where={where} />
      ) : (
        <BudgetList budgets={policy.budgets} usage={usage} where={where} />
      )}
    </>
  );
}
