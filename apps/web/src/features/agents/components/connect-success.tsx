"use client";

import Link from "next/link";
import { Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Card, Disclosure } from "@/components/app/card";
import { useLiveJson } from "@/components/app/live";
import { SecretReveal } from "@/components/app/secret-reveal";
import { Button } from "@/components/ui/button";
import type { CheckInDto, ConnectedAgentDto } from "@/contracts/v1/agents";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ConnectPlace } from "../setup-snippets";
import { SetupInstructions } from "./setup-instructions";

/** How often a just-connected agent's setup asks whether it checked in. */
const CHECK_IN_POLL_MS = 4_000;

type CheckKey = keyof CheckInDto["checks"];

/** What to verify once it runs; the first three tick from its own decisions. */
const checks: { key: CheckKey | null; title: string; detail: string }[] = [
  {
    key: "allowed",
    title: "An action a rule allows",
    detail: "Runs, once your integration has the allow from Nodrail.",
  },
  {
    key: "blocked",
    title: "An action no rule covers",
    detail:
      "Is denied, with the reason, so you can add a rule if it should run.",
  },
  {
    key: "denied",
    title: "An action a rule denies",
    detail: "Is refused, and the tool call doesn't run.",
  },
  {
    key: null,
    title: "Nodrail out of reach",
    detail:
      "Test by hand: with a timeout or a bad answer, the covered call must not run.",
  },
  {
    key: null,
    title: "Routes around the integration",
    detail:
      "Note by hand any direct route this integration doesn't see, such as another credential.",
  },
];

/** Asks for the agent's check-in until it has one, then less often. */
function useCheckIn(href: string) {
  const [state, setState] = useState<CheckInDto | null>(null);
  useLiveJson<CheckInDto>(href, setState, CHECK_IN_POLL_MS);
  return state;
}

/** "Waiting for first check-in…", then "✓ Checked in …: open the agent". */
function CheckInLine({
  lastSeenAt,
  agentHref,
}: {
  lastSeenAt: string | null;
  agentHref: string;
}) {
  return (
    <p
      role="status"
      data-slot="check-in"
      data-checked-in={lastSeenAt ? "" : undefined}
      className={cn(
        "mt-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2.5 text-ui [&_svg]:size-4",
        lastSeenAt
          ? "bg-success-soft text-success"
          : "bg-muted text-muted-foreground",
      )}
    >
      {lastSeenAt ? (
        <>
          <Check aria-hidden="true" className="animate-pop" />
          <span>
            Checked in{" "}
            <span suppressHydrationWarning>{timeAgo(lastSeenAt)}</span>.
          </span>
          <Link href={agentHref} className="font-semibold underline">
            Open the agent
          </Link>
        </>
      ) : (
        <>
          <LoaderCircle aria-hidden="true" className="animate-spin" />
          Waiting for first check-in…
        </>
      )}
    </p>
  );
}

/** The checks, each ticked once the agent's own decisions show it. */
function SetupChecks({ seen }: { seen: CheckInDto["checks"] | null }) {
  return (
    <div data-slot="setup-checks">
      <Card
        title="Checks to run"
        description="Try each once it is installed. The first three tick themselves from this agent's decisions."
      >
        <ul className="grid gap-2.5">
          {checks.map(({ key, title, detail }) => {
            const done = key !== null && Boolean(seen?.[key]);
            return (
              <li
                key={title}
                data-slot="setup-check"
                data-done={done ? "" : undefined}
                className="flex items-start gap-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-micro [&_svg]:size-3",
                    done
                      ? "bg-success-soft text-success"
                      : "border text-muted-foreground",
                  )}
                >
                  {done ? <Check /> : null}
                </span>
                <span className="grid gap-[3px]">
                  <b className="text-ui font-semibold text-body">
                    <span className="sr-only">
                      {done ? "Seen: " : key ? "Not seen yet: " : "By hand: "}
                    </span>
                    {title}
                  </b>
                  <small className="text-xs leading-[1.4] text-muted-foreground">
                    {detail}
                  </small>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

/**
 * After connecting: the credential, shown once, how to install it, the
 * first check-in as it happens, and the checks to run, ticked as they show.
 */
export function ConnectSuccess({
  connected,
  environmentName,
  agentsPath,
  serverUrl,
  place,
}: {
  connected: ConnectedAgentDto;
  environmentName: string;
  agentsPath: string;
  serverUrl: string;
  place: ConnectPlace;
}) {
  const { agentKey, installationName, adapterKey, credential } = connected;
  const agentHref = `${agentsPath}/${agentKey}`;
  const checkIn = useCheckIn(`${agentHref}/check-in`);
  return (
    <div className="grid gap-3">
      <Card
        title={`${agentKey} is connected`}
        description={`Installation ${installationName} in ${environmentName}. Save the credential, then set up its host.`}
      >
        <SecretReveal label="Agent credential" secret={credential.secret}>
          <Button asChild variant="outline">
            <Link href={agentHref}>View agent</Link>
          </Button>
        </SecretReveal>
        <SetupInstructions
          adapterKey={adapterKey}
          serverUrl={serverUrl}
          place={place}
        />
        <CheckInLine
          lastSeenAt={checkIn?.lastSeenAt ?? null}
          agentHref={agentHref}
        />
      </Card>
      <SetupChecks seen={checkIn?.checks ?? null} />
      <CoverageLimits />
    </div>
  );
}

/** What any setup does and doesn't control, folded away under the steps. */
export function CoverageLimits() {
  return (
    <Disclosure summary="Limits of coverage">
      This setup controls calls that use this configured integration. It does
      not isolate an agent, prevent direct credential use, or block a separate
      network route.
    </Disclosure>
  );
}
