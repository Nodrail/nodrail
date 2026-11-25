import type { Metadata } from "next";
import { RunPolicyEntryPage } from "@/features/policies/components/run-policy-page";

export const metadata: Metadata = { title: "New gate" };

export default async function NewGatePage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/gates/new">) {
  const { workspace, environment } = await params;
  return (
    <RunPolicyEntryPage
      workspace={workspace}
      environment={environment}
      kind="gate"
    />
  );
}
