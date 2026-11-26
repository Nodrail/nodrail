import { docsUrl } from "@/features/guidance/docs-url";
import Link from "next/link";
import { Disclosure, EmptyState } from "@/components/app/card";
import { ListSkeleton } from "@/components/app/skeleton-lists";
import {
  DisclosureSkeleton,
  LineSkeleton,
  LoadingPage,
} from "@/components/app/skeletons";
import { cardTitle } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import { readForPage } from "@/features/shell/load-view";
import type { AgentListItemDto } from "@/contracts/v1/agents";
import { listAgents } from "@/server/modules/agents";
import { AgentRow } from "./agent-row";
import { appPath } from "@/lib/product-path";

/** The agents while they load: the count line over the list of agent rows. */
export function AgentListSkeleton() {
  return (
    <LoadingPage label="agents">
      <div className="mx-px mb-2.5 flex items-baseline justify-between gap-3">
        <LineSkeleton className="w-28 text-title" />
        <LineSkeleton className="w-36 text-xs" />
      </div>
      <ListSkeleton rows={4} boxed lines={3} />
      <DisclosureSkeleton />
    </LoadingPage>
  );
}

/** One page of the environment's agents, or what to do while there are none. */
export async function AgentList({
  workspace,
  environment,
  cursor,
  canConnect,
  canManage,
}: {
  workspace: string;
  environment: string;
  cursor?: string;
  canConnect: boolean;
  canManage: boolean;
}) {
  const list = await readForPage(workspace, (context) =>
    listAgents(context, environment, cursor),
  );
  const base = appPath(workspace, environment);

  if (list.summary.connected === 0 && list.items.length === 0)
    return (
      <EmptyState
        title={
          canConnect ? "No agents registered yet" : "No agents to show yet"
        }
        action={
          canConnect ? (
            <Button asChild variant="outline">
              <a href={docsUrl("quickstart")}>Read the quickstart</a>
            </Button>
          ) : null
        }
      >
        {canConnect
          ? "Agents declared in nodrail.yaml appear here after you apply the project. Standalone integrations appear here after their credential is created."
          : "Agents appear here once an admin assigns them to you."}
      </EmptyState>
    );

  return (
    <>
      <AgentListCount
        connected={list.summary.connected}
        reporting={list.summary.reporting}
      />
      <AgentGroups
        items={list.items}
        base={base}
        workspace={workspace}
        canManage={canManage}
      />
      {list.nextCursor ? (
        <p className="mt-3">
          <Button asChild variant="outline">
            <Link href={`${base}/agents?cursor=${list.nextCursor}`}>
              Next page
            </Link>
          </Button>
        </p>
      ) : null}
      <Disclosure summary="What does “reporting” mean?">
        It means a connected installation recently sent a check-in. It does not
        verify that a tool call ran or cover calls made outside that
        integration.
      </Disclosure>
    </>
  );
}

function AgentGroups({
  items,
  base,
  workspace,
  canManage,
}: {
  items: AgentListItemDto[];
  base: string;
  workspace: string;
  canManage: boolean;
}) {
  const fallback = (agent: AgentListItemDto) =>
    agent.installation?.machineKey === agent.key;
  const rows = (agents: AgentListItemDto[]) =>
    agents.map((agent) => (
      <AgentRow
        key={agent.key}
        agent={agent}
        href={`${base}/agents/${agent.key}`}
        workspace={workspace}
        base={base}
        canManage={canManage}
      />
    ));
  const unidentified = items.filter(fallback);
  return (
    <>
      <ul
        aria-label="Agents"
        data-tour="agents-list"
        className="stagger grid gap-1.75"
      >
        {rows(items.filter((agent) => !fallback(agent)))}
      </ul>
      {unidentified.length ? (
        <ul
          id="machines"
          aria-label="Unidentified callers"
          className="stagger mt-4 grid gap-1.75"
        >
          {rows(unidentified)}
        </ul>
      ) : null}
    </>
  );
}

function AgentListCount({
  connected,
  reporting,
}: {
  connected: number;
  reporting: number;
}) {
  return (
    <div className="mx-px mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className={cardTitle}>Your agents</h2>
      <span data-tour="agents-status" className="text-xs text-muted-foreground">
        <strong
          key={connected}
          className="inline-block animate-pop font-semibold"
        >
          {connected} connected{" "}
          {connected === 1 ? "installation" : "installations"}
        </strong>{" "}
        · {reporting} reporting
      </span>
    </div>
  );
}
