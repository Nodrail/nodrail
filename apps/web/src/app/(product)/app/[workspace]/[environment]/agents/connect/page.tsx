import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectAgentForm } from "@/features/agents/components/connect-agent-form";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { firstParam } from "@/lib/search-params";
import { appOrigin } from "@/server/app-origin";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Connect an agent" };

export default async function ConnectAgentPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/agents/connect">) {
  const { workspace, environment } = await params;
  const { agent } = await searchParams;
  const view = await loadWorkspaceView(workspace);
  if (!view.capabilities.includes("agents:manage")) notFound();
  const current = view.environments.find((item) => item.slug === environment);
  const agentsPath = appPath(workspace, environment, "agents");
  return (
    <>
      <PageHeader
        title="Connect an agent"
        purpose={`Give your agent its own identity and credential in ${current?.name ?? environment}, then see it check in.`}
        back={{ href: agentsPath, label: "Back to agents" }}
      />
      <ConnectAgentForm
        workspace={workspace}
        environmentSlug={environment}
        environmentName={current?.name ?? environment}
        agentsPath={agentsPath}
        serverUrl={appOrigin()}
        initialKey={firstParam(agent) ?? ""}
      />
    </>
  );
}
