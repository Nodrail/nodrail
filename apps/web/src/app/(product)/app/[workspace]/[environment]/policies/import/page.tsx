import { starterPacks } from "@nodrail/policy-engine/yaml";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyFileImport } from "@/features/policies/components/policy-file-import";
import { environmentName } from "@/features/policies/components/rule-environment";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { appPath } from "@/lib/product-path";
import { firstParam } from "@/lib/search-params";
import { Note } from "@/components/app/note";
import { VERSION_NOT_RENDERABLE_MESSAGE } from "@/contracts/v1/policies";
import { policyFileForPage } from "@/server/modules/policies/file-page";

export const metadata: Metadata = { title: "Import rules" };

/**
 * Makes this environment's policies match a file: pasted, uploaded, a
 * starter pack, or (with `from`) another environment's live policies, which
 * is how they are copied between environments. Nothing publishes before the
 * preview is confirmed.
 */
export default async function ImportRulesPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/policies/import">) {
  const { workspace, environment } = await params;
  const { pack, from } = await searchParams;
  const starter = Object.entries(starterPacks).find(
    ([key]) => key === pack,
  )?.[1];
  const view = await loadWorkspaceView(workspace);
  if (!view.capabilities.includes("policies:write")) notFound();
  const name = environmentName(view.environments, environment);
  const source = view.environments.find(
    (item) => item.slug === firstParam(from) && item.slug !== environment,
  );
  const copied = source
    ? await readForPage(workspace, (context) =>
        policyFileForPage(context, source.slug),
      )
    : null;
  const policies = appPath(workspace, environment, "policies");
  return (
    <>
      <PageHeader
        title={source ? `Copy policies to ${name}` : "Import rules"}
        purpose={
          source
            ? `${source.name}'s live policies, ready to review. Publishing makes ${name} match them; ${source.name} does not change.`
            : `Make the rules in ${name} match a YAML file.`
        }
        back={{ href: policies, label: "Back to policies" }}
      />
      {source && copied === null ? (
        <Note tone="warning" data-slot="yaml-not-renderable">
          {VERSION_NOT_RENDERABLE_MESSAGE}
        </Note>
      ) : null}
      <PolicyFileImport
        workspace={workspace}
        environment={environment}
        policiesPath={policies}
        initialText={copied ?? starter?.text ?? ""}
        previewOnLoad={copied !== null}
      />
    </>
  );
}
