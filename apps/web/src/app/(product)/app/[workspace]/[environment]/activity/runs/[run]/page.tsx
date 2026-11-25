import type { Metadata } from "next";
import { Card, FactList } from "@/components/app/card";
import { ActivityLink } from "@/features/activity/components/activity-link";
import { PageTour } from "@/features/guidance/components/page-tour";
import { Count } from "@/features/runs/components/run-list";
import { RunTimeline } from "@/features/runs/components/run-timeline";
import { PageHeader } from "@/features/shell/components/page-header";
import { readForPage } from "@/features/shell/load-view";
import { formatUtc, timeAgo } from "@/lib/time";
import { getRun } from "@/server/modules/runs";
import { DataEmpty } from "@/components/app/data-table";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Run" };

/**
 * One run, step by step: the deep view behind Activity's runs. The run is the
 * check that can reject this address, so no placeholder streams before it.
 */
export default async function RunPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/activity/runs/[run]">) {
  const { workspace, environment, run: runId } = await params;
  const run = await readForPage(workspace, (context) =>
    getRun(context, environment, runId),
  );
  const base = appPath(workspace, environment);
  return (
    <>
      <PageHeader
        title={run.key}
        purpose={`Run started ${formatUtc(run.createdAt)} by ${run.installationName}`}
        back={{ href: `${base}/activity?view=runs`, label: "Back to runs" }}
        action={
          <ActivityLink
            href={`${base}/activity?run=${run.id}`}
            data-tour="run-activity"
          />
        }
      />
      <div className="grid gap-4">
        <div data-tour="run-summary">
          <FactList
            facts={[
              { label: "Steps", value: <Count value={run.steps} /> },
              { label: "Actions", value: <Count value={run.actions} /> },
              {
                label: "Stopped by a gate or budget",
                value: <Count value={run.held} />,
              },
              { label: "Last activity", value: timeAgo(run.lastActivityAt) },
            ]}
          />
        </div>
        <div data-tour="run-timeline">
          <Card
            title="Timeline"
            description="Steps as each integration reported them, and every action decided in this run. A verdict is what the agent said."
          >
            {run.timeline.length ? (
              <RunTimeline
                entries={run.timeline}
                mainAgent={run.agentKey}
                activityPath={`${base}/activity`}
              />
            ) : (
              <DataEmpty>Nothing recorded yet.</DataEmpty>
            )}
          </Card>
        </div>
      </div>
      <PageTour tour="run" ready />
    </>
  );
}
