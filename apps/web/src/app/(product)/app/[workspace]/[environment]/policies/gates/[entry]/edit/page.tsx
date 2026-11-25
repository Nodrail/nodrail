import type { Metadata } from "next";
import { RunPolicyEntryPage } from "@/features/policies/components/run-policy-page";

export const metadata: Metadata = { title: "Edit gate" };

/** One live gate in its form; saving publishes a new version. */
export default async function EditGatePage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/gates/[entry]/edit">) {
  const { workspace, environment, entry } = await params;
  return (
    <RunPolicyEntryPage
      workspace={workspace}
      environment={environment}
      kind="gate"
      id={entry}
    />
  );
}
