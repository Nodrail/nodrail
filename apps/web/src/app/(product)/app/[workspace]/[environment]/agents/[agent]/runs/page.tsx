import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/card";
import { DataPanel } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { ListCount } from "@/features/activity/components/activity-results";
import { activityHref, clearedQuery } from "@/features/activity/filters";
import { AgentHeader } from "@/features/agents/components/agent-header";
import { loadAgentPage } from "@/features/agents/load";
import { RunsTable } from "@/features/runs/components/runs-table";
import { readForPage } from "@/features/shell/load-view";
import { listRuns } from "@/server/modules/runs";

type Props = PageProps<"/app/[workspace]/[environment]/agents/[agent]/runs">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await params).agent} runs` };
}

/** The runs this agent took a step in, most recently active first. */
export default async function AgentRunsPage({ params }: Props) {
  const { workspace, environment, agent: agentKey } = await params;
  const page = await loadAgentPage(workspace, environment, agentKey);
  const { agent, base } = page;
  const query = { ...clearedQuery, agent: agent.key };
  const list = await readForPage(workspace, (context) =>
    listRuns(context, environment, query),
  );

  return (
    <>
      <AgentHeader page={page} workspace={workspace} current="runs" />
      {list.runs.length === 0 ? (
        <EmptyState
          title={`No runs for ${agent.key} yet`}
          action={
            <Button asChild variant="outline">
              <a href="/docs/runs">How runs work</a>
            </Button>
          }
        >
          A run is one job, such as a branch or an issue, with every step and
          action in it. This agent&apos;s runs show here once its integration
          reports the steps it takes.
        </EmptyState>
      ) : (
        <>
          <DataPanel data-tour="agent-runs">
            <ListCount
              count={list.runs.length}
              noun="run"
              paged={Boolean(list.nextCursor)}
              order="Most recently active first"
            />
            <RunsTable base={base} runs={list.runs} />
          </DataPanel>
          {list.nextCursor ? (
            <p className="mt-2.5">
              <Button asChild variant="outline">
                <Link href={activityHref(`${base}/activity`, query, "runs")}>
                  All runs in Activity
                </Link>
              </Button>
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
