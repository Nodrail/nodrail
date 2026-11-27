import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  AgentList,
  AgentListSkeleton,
} from "@/features/agents/components/agent-list";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView, readableCursor } from "@/features/shell/load-view";
import { allSections } from "@/features/shell/navigation";
import { firstParam } from "@/lib/search-params";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Agents" };

const section = allSections.find((item) => item.slug === "agents");

/** The address is checked before anything streams; the list loads behind a placeholder. */
export default async function AgentsPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/agents">) {
  const { workspace, environment } = await params;
  const cursor = readableCursor(firstParam((await searchParams).cursor));
  const view = await loadWorkspaceView(workspace);
  const canManage = view.capabilities.includes("agents:manage");
  const canConnect = canManage || view.capabilities.includes("policies:write");

  return (
    <>
      <PageHeader
        title="Agents"
        purpose={section?.purpose ?? ""}
        action={
          canConnect ? (
            <Button asChild>
              <Link
                href={appPath(workspace, environment, "agents/connect")}
                data-tour="agents-connect"
              >
                Connect a project
              </Link>
            </Button>
          ) : null
        }
      />
      <Suspense fallback={<AgentListSkeleton />}>
        <AgentList
          workspace={workspace}
          environment={environment}
          cursor={cursor}
          canConnect={canConnect}
          canManage={canManage}
        />
      </Suspense>
    </>
  );
}
