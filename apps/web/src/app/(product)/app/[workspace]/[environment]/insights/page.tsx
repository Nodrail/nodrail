import type { Metadata } from "next";
import { ListSummary } from "@/components/app/data-table";
import { reportWindow } from "@/contracts/v1/reports";
import { InsightSections } from "@/features/reports/components/insight-sections";
import { WindowSwitch } from "@/features/reports/components/window-switch";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { allSections } from "@/features/shell/navigation";
import { firstParam } from "@/lib/search-params";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Insights" };

const section = allSections.find((item) => item.slug === "insights");

/**
 * Questions about how decisions, rules, gates and agent teams are working,
 * each ending in something to do. Nothing here can reject the address (the
 * layout checks the environment; an unknown window is the default), so the
 * header and window switch render at once and each section loads on its own.
 */
export default async function InsightsPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/insights">) {
  const { workspace, environment } = await params;
  const days = reportWindow(firstParam((await searchParams).days));
  const view = await loadWorkspaceView(workspace);
  const base = appPath(workspace, environment);
  return (
    <>
      <PageHeader title="Insights" purpose={section?.purpose ?? ""} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ListSummary className="mb-0">
          The last {days} days in this environment, each with what to do next.
        </ListSummary>
        <WindowSwitch base={base} days={days} />
      </div>
      <InsightSections
        workspace={workspace}
        environment={environment}
        days={days}
        canImport={view.capabilities.includes("policies:write")}
      />
    </>
  );
}
