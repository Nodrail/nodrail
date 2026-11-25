import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/app/card";
import { DataEmpty, DataPanel, ListPager } from "@/components/app/data-table";
import { DataTableSkeleton } from "@/components/app/skeleton-lists";
import {
  LineSkeleton,
  LoadingPage,
  skeletonKeys,
} from "@/components/app/skeletons";
import { Button } from "@/components/ui/button";
import type { ActivityDetailDto } from "@/contracts/v1/activity";
import type {
  ActivityQuery,
  ActivityView,
} from "@/contracts/v1/activity-query";
import { Count } from "@/features/runs/components/run-list";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { listActivity } from "@/server/modules/activity";
import { listAgentOptions } from "@/server/modules/agents";
import { activityHref, isFiltered } from "../filters";
import { ActivityFilters } from "./activity-filters";
import { ActivityKey, activityKeyBox } from "./activity-key";
import { EventsBoard } from "./events-board";
import { appPath } from "@/lib/product-path";

/** The list while it loads: for events the key, then the filtered table. */
export function ActivityResultsSkeleton({ view }: { view: ActivityView }) {
  return (
    <LoadingPage label={view === "runs" ? "runs" : "activity"}>
      {view === "events" ? (
        <div className={activityKeyBox}>
          {skeletonKeys(2).map((index) => (
            <div key={index}>
              <LineSkeleton className="w-16 text-xs" />
              <LineSkeleton className="w-32 text-xs" />
            </div>
          ))}
          <LineSkeleton className="ml-auto w-56 text-xs phone:ml-0" />
        </div>
      ) : null}
      <DataTableSkeleton
        columns={view === "runs" ? 6 : 5}
        actions={1}
        rows={10}
        toolbar={view === "runs" ? 4 : 5}
        countBar
      />
    </LoadingPage>
  );
}

/** The count over a list: how many, on this page or in all, and the order. */
export function ListCount({
  count,
  noun,
  paged,
  order,
}: {
  count: number;
  noun: string;
  paged: boolean;
  order: string;
}) {
  return (
    <p
      className="flex justify-between border-b px-3.25 py-2.25 text-xs text-muted-foreground"
      role="status"
    >
      <span>
        <Count value={count} /> {count === 1 ? noun : `${noun}s`}
        {paged ? " on this page" : ""}
      </span>
      <span>{order}</span>
    </p>
  );
}

/** No row matches: says so, and offers to clear every filter of this view. */
export function NoMatch({
  noun,
  clearHref,
}: {
  noun: string;
  clearHref: string;
}) {
  return (
    <DataEmpty data-slot="no-match">
      <b>No {noun} match these filters</b>
      Clear them, or try a longer time range.
      <span className="mt-3 block">
        <Button asChild variant="outline">
          <Link href={clearHref}>Clear filters</Link>
        </Button>
      </span>
    </DataEmpty>
  );
}

/** Nothing recorded yet: what will be, and how it starts. */
async function NoActivity({
  workspace,
  environment,
}: {
  workspace: string;
  environment: string;
}) {
  const view = await loadWorkspaceView(workspace);
  const canConnect = view.capabilities.includes("agents:manage");
  return (
    <EmptyState
      title="No activity yet"
      action={
        <Button asChild variant="outline">
          {canConnect ? (
            <Link href={appPath(workspace, environment, "agents/connect")}>
              Connect an agent
            </Link>
          ) : (
            <a href="/docs/quickstart">How agents connect</a>
          )}
        </Button>
      }
    >
      Every decision Nodrail makes for your agents, and every change to rules
      and access, is listed here. It starts when a connected agent asks before
      acting.
    </EmptyState>
  );
}

type ResultsProps = {
  workspace: string;
  environment: string;
  query: ActivityQuery;
};

/** One page of events for the query, its filters and the way to older ones. */
export async function ActivityResults({
  workspace,
  environment,
  query,
  selected,
  runKey,
}: ResultsProps & {
  selected: ActivityDetailDto | null;
  runKey: string | null;
}): Promise<ReactNode> {
  const [page, agents] = await readForPage(workspace, async (context) => [
    await listActivity(context, environment, query),
    await listAgentOptions(context, environment),
  ]);
  const path = appPath(workspace, environment, "activity");

  if (page.items.length === 0 && !isFiltered(query) && !query.cursor)
    return <NoActivity workspace={workspace} environment={environment} />;

  return (
    <>
      <ActivityKey />
      <DataPanel>
        <ActivityFilters
          path={path}
          query={query}
          agents={agents.map((agent) => agent.key)}
          runKey={runKey}
        />
        <ListCount
          count={page.items.length}
          noun="event"
          paged={Boolean(page.nextCursor || query.cursor)}
          order="Newest first"
        />
        <EventsBoard
          workspace={workspace}
          environment={environment}
          items={page.items}
          selected={selected}
          query={query}
          empty={<NoMatch noun="events" clearHref={path} />}
        />
      </DataPanel>
      <ListPager
        newest={
          query.cursor
            ? activityHref(path, { ...query, cursor: undefined })
            : null
        }
        next={
          page.nextCursor
            ? activityHref(path, { ...query, cursor: page.nextCursor })
            : null
        }
        nextLabel="Older events"
      />
    </>
  );
}
