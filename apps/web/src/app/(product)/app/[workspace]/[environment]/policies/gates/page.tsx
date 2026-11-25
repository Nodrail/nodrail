import type { Metadata } from "next";
import { RunPolicyTab } from "@/features/policies/components/run-policy-tab";

export const metadata: Metadata = { title: "Gates" };

/** Policies' Gates tab: the gates checked against each run. */
export default async function PolicyGatesPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/gates">) {
  const { workspace, environment } = await params;
  return (
    <RunPolicyTab workspace={workspace} environment={environment} kind="gate" />
  );
}
