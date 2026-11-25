import type { Metadata } from "next";
import { RunPolicyEntryPage } from "@/features/policies/components/run-policy-page";

export const metadata: Metadata = { title: "New budget" };

export default async function NewBudgetPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/budgets/new">) {
  const { workspace, environment } = await params;
  return (
    <RunPolicyEntryPage
      workspace={workspace}
      environment={environment}
      kind="budget"
    />
  );
}
