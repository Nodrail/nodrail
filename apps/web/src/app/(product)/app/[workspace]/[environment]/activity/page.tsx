import type { Metadata } from "next";
import { Suspense } from "react";
import {
  ActivityResults,
  ActivityResultsSkeleton,
} from "@/features/activity/components/activity-results";
import { ExportMenu } from "@/features/activity/components/export-menu";
import { ViewSwitch } from "@/features/activity/components/view-switch";
import { LocalReports } from "@/features/reporting/components/local-reports";
import { exportHref, readActivityParams } from "@/features/activity/filters";
import { RunsResults } from "@/features/runs/components/runs-results";
import { PageHeader } from "@/features/shell/components/page-header";
import { readableCursor, readForPage } from "@/features/shell/load-view";
import { allSections } from "@/features/shell/navigation";
import { getActivityEvent } from "@/server/modules/activity";
import { getRunSummary } from "@/server/modules/runs";
import { appPath } from "@/lib/product-path";

export const metadata: Metadata = { title: "Activity" };

const section = allSections.find((item) => item.slug === "activity");

/**
 * Every event, or the runs they belong to, under one set of filters. The
 * address is checked before anything streams (its cursor, the run it narrows
 * to, the event open in the panel), so a damaged one answers 404; only the
 * list loads behind the placeholder.
 */
export default async function ActivityPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/activity">) {
  const { workspace, environment } = await params;
  const { view, query, event } = readActivityParams(await searchParams);
  readableCursor(query.cursor);
  const events = view === "events";
  const run =
    events && query.run
      ? await readForPage(workspace, (context) =>
          getRunSummary(context, environment, query.run),
        )
      : null;
  const selected =
    events && event
      ? await readForPage(workspace, (context) =>
          getActivityEvent(context, environment, event),
        )
      : null;
  const path = appPath(workspace, environment, "activity");
  return (
    <>
      <PageHeader
        title="Activity"
        purpose={section?.purpose ?? ""}
        action={
          events ? (
            <ExportMenu
              hrefFor={{
                csv: exportHref(path, query, "csv"),
                json: exportHref(path, query, "json"),
              }}
            />
          ) : undefined
        }
      />
      <ViewSwitch path={path} query={query} view={view} />
      <Suspense
        fallback={
          <ActivityResultsSkeleton view={view === "local" ? "events" : view} />
        }
      >
        {view === "local" ? (
          <LocalReports workspace={workspace} environment={environment} />
        ) : events ? (
          <ActivityResults
            workspace={workspace}
            environment={environment}
            query={query}
            selected={selected}
            runKey={run?.key ?? null}
          />
        ) : (
          <RunsResults
            workspace={workspace}
            environment={environment}
            query={query}
          />
        )}
      </Suspense>
    </>
  );
}
