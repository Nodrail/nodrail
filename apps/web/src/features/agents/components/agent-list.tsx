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
}: {
  workspace: string;
  environment: string;
  cursor?: string;
  canConnect: boolean;
}) {
  const list = await readForPage(workspace, (context) =>
    listAgents(context, environment, cursor),
  );
  const base = appPath(workspace, environment);

  if (list.summary.connected === 0)
    return (
      <EmptyState
        title={canConnect ? "No agents connected yet" : "No agents to show yet"}
        action={
          canConnect ? (
            <Button asChild variant="outline">
              <a href="/docs/quickstart">Read the quickstart</a>
            </Button>
          ) : null
        }
      >
        {canConnect
          ? "An agent is any tool that asks Nodrail before it acts, such as Claude Code or your own app. Connect one to give it an identity and a credential; your provider keys stay with your team."
          : "Agents appear here once an admin connects them and assigns them to you."}
      </EmptyState>
    );

  return (
    <>
      <div className="mx-px mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className={cardTitle}>Your agents</h2>
        <span
          data-tour="agents-status"
          className="text-xs text-muted-foreground"
        >
          <strong
            key={list.summary.connected}
            className="inline-block animate-pop font-semibold"
          >
            {list.summary.connected} connected
          </strong>{" "}
          · {list.summary.reporting} reporting
        </span>
      </div>
      <ul data-tour="agents-list" className="stagger grid gap-1.75">
        {list.items.map((agent) => (
          <AgentRow
            key={agent.key}
            agent={agent}
            href={`${base}/agents/${agent.key}`}
            workspace={workspace}
            base={base}
            canManage={canConnect}
          />
        ))}
      </ul>
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
        It means the configured client integration recently sent a check-in. It
        does not verify that a tool call ran or cover calls made outside that
        integration.
      </Disclosure>
    </>
  );
}
