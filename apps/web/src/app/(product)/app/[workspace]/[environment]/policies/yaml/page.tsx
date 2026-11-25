import type { Metadata } from "next";
import { PageTour } from "@/features/guidance/components/page-tour";
import { PoliciesHeader } from "@/features/policies/components/policies-header";
import { PolicyYamlEditor } from "@/features/policies/components/policy-yaml-editor";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { Note } from "@/components/app/note";
import { VERSION_NOT_RENDERABLE_MESSAGE } from "@/contracts/v1/policies";
import { policyFileForPage } from "@/server/modules/policies/file-page";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Policies as YAML" };

export default async function PoliciesYamlPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/policies/yaml">) {
  const { workspace, environment } = await params;
  const view = await loadWorkspaceView(workspace);
  const live = await readForPage(workspace, (context) =>
    policyFileForPage(context, environment),
  );
  const text = live ?? "";
  const canManage = view.capabilities.includes("policies:write");
  return (
    <>
      <PoliciesHeader
        workspace={workspace}
        environment={environment}
        environments={view.environments}
        canManage={canManage}
        current="yaml"
      />
      {live === null ? (
        <Note tone="warning" data-slot="yaml-not-renderable">
          {VERSION_NOT_RENDERABLE_MESSAGE}
        </Note>
      ) : null}
      <PolicyYamlEditor
        workspace={workspace}
        environment={environment}
        policiesPath={appPath(workspace, environment, "policies")}
        initialText={text}
        canWrite={canManage}
      />
      <PageTour tour="policies-yaml" ready={text.trim().length > 0} />
    </>
  );
}
