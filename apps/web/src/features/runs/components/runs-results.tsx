import { docsUrl } from "@/features/guidance/docs-url";
import { EmptyState } from "@/components/app/card";
import { Button } from "@/components/ui/button";
import { DataPanel, ListPager } from "@/components/app/data-table";
import type { ActivityQuery } from "@/contracts/v1/activity-query";
import { activityHref, isFiltered } from "@/features/activity/filters";
import { ActivityFilters } from "@/features/activity/components/activity-filters";
import {
  ListCount,
  NoMatch,
} from "@/features/activity/components/activity-results";
import { PageTour } from "@/features/guidance/components/page-tour";
import { readForPage } from "@/features/shell/load-view";
import { listAgentOptions } from "@/server/modules/agents";
import { listRuns } from "@/server/modules/runs";
import { RunsTable } from "./runs-table";
import { appPath } from "@/lib/product-path";

/** Activity by run: one page of runs for the shared filters. */
export async function RunsResults({
  workspace,
  environment,
  query,
}: {
  workspace: string;
  environment: string;
  query: ActivityQuery;
}) {
  const [page, agents] = await readForPage(workspace, async (context) => [
    await listRuns(context, environment, query),
    await listAgentOptions(context, environment),
  ]);
  const base = appPath(workspace, environment);
  const path = `${base}/activity`;
  const href = (cursor: string | undefined) =>
    activityHref(path, { ...query, cursor }, "runs");

  if (page.runs.length === 0 && !isFiltered(query, "runs") && !query.cursor)
    return (
      <EmptyState
        title="No runs yet"
        action={
          <Button asChild variant="outline">
            <a href={docsUrl("runs")}>How runs work</a>
          </Button>
        }
      >
        A first tool decision can create a run for a job such as a branch or an
        issue. The run shows its decisions as they arrive. Step reporting
        depends on the host and integration.
      </EmptyState>
    );

  return (
    <>
      <DataPanel>
        <ActivityFilters
          path={path}
          view="runs"
          query={query}
          agents={agents.map((agent) => agent.key)}
        />
        <ListCount
          count={page.runs.length}
          noun="run"
          paged={Boolean(page.nextCursor || query.cursor)}
          order="Most recently active first"
        />
        {page.runs.length ? (
          <RunsTable base={base} runs={page.runs} />
        ) : (
          <NoMatch noun="runs" clearHref={`${path}?view=runs`} />
        )}
      </DataPanel>
      <ListPager
        newest={query.cursor ? href(undefined) : null}
        next={page.nextCursor ? href(page.nextCursor) : null}
        nextLabel="Older runs"
      />
      <PageTour tour="activity" ready={page.runs.length > 0} />
    </>
  );
}
