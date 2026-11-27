import { randomBytes, randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConnectProject } from "@/features/agents/components/connect-project";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { firstParam } from "@/lib/search-params";
import { appOrigin } from "@/server/app-origin";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Connect a project" };

export default async function ConnectAgentPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/agents/connect">) {
  const { workspace, environment } = await params;
  const { agent } = await searchParams;
  const view = await loadWorkspaceView(workspace);
  const canCreateStandalone = view.capabilities.includes("agents:manage");
  if (!canCreateStandalone && !view.capabilities.includes("policies:write"))
    notFound();
  const current = view.environments.find((item) => item.slug === environment);
  const agentsPath = appPath(workspace, environment, "agents");
  return (
    <>
      <PageHeader
        title="Connect a project"
        purpose={`Set up your project for ${current?.name ?? environment} and verify its first decision.`}
        back={{ href: agentsPath, label: "Back to agents" }}
      />
      <ConnectProject
        place={{ workspace, environment }}
        projectId={randomUUID()}
        checkInMarker={`nodrail-check-${randomBytes(8).toString("hex")}`}
        canCreateStandalone={canCreateStandalone}
        activityPath={appPath(workspace, environment, "activity")}
        environmentName={current?.name ?? environment}
        agentsPath={agentsPath}
        serverUrl={appOrigin()}
        initialKey={firstParam(agent) ?? ""}
      />
    </>
  );
}
