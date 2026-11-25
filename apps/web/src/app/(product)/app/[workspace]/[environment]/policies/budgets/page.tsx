import type { Metadata } from "next";
import { RunPolicyTab } from "@/features/policies/components/run-policy-tab";

export const metadata: Metadata = { title: "Budgets" };

/** Policies' Budgets tab: the budgets checked against each run. */
export default async function PolicyBudgetsPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/budgets">) {
  const { workspace, environment } = await params;
  return (
    <RunPolicyTab
      workspace={workspace}
      environment={environment}
      kind="budget"
    />
  );
}
