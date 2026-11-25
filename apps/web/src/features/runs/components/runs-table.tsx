import type { Tone } from "@/components/app/tones";
import { StatusBadge } from "@/components/app/status-badge";
import type { RunStatus, RunSummaryDto } from "@/contracts/v1/runs";
import { plural } from "@/lib/text";
import { timeAgo } from "@/lib/time";
import { holdLabel, outcomeLabels } from "@/contracts/v1/glossary";
import { reportTone, runPath } from "../presentation";
import {
  DataActionsCell,
  DataActionsHeading,
  DataTable,
  DataTitleLink,
} from "@/components/app/data-table";
import { RowActions } from "@/components/app/row-actions";

/** How a run stands, in words and tone; shared with Overview. */
export const runStatuses: Record<RunStatus, { tone: Tone; label: string }> = {
  held: { tone: "warning", label: outcomeLabels.held },
  running: { tone: "neutral", label: "Step in progress" },
  idle: { tone: "neutral", label: "Idle" },
};

/** Each step agent with its steps: "dev 2 · qa 2". */
function StepsCell({ run }: { run: RunSummaryDto }) {
  return (
    <td>
      {run.agents.length
        ? run.agents.map(({ agent, steps }) => `${agent} ${steps}`).join(" · ")
        : "No steps yet"}
      <small>
        {plural(run.steps, "step")} · {plural(run.actions, "action")}
      </small>
    </td>
  );
}

/**
 * What each agent's latest step said, a failing verdict in red; a verdict is
 * the agent's own word.
 */
function VerdictsCell({ run }: { run: RunSummaryDto }) {
  if (!run.agents.length) return <td data-blank>—</td>;
  return (
    <td>
      <span className="flex flex-wrap gap-x-2.5 gap-y-1">
        {run.agents.map(({ agent, verdict, finished }) => (
          <span
            key={agent}
            data-slot="run-verdict"
            className="whitespace-nowrap"
          >
            {agent}:{" "}
            <StatusBadge tone={reportTone(finished, verdict)}>
              {finished ? (verdict ?? "no verdict") : "working"}
            </StatusBadge>
          </span>
        ))}
      </span>
    </td>
  );
}

/** Actions a gate or budget denied so far. */
function HeldCell({ run }: { run: RunSummaryDto }) {
  return <td>{run.held ? plural(run.held, "action") : "None"}</td>;
}

/** How the run stands, and the gate or budget holding it, if one is. */
function StatusCell({ run }: { run: RunSummaryDto }) {
  const status = runStatuses[run.status];
  return (
    <td>
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      {run.holding ? (
        <small data-slot="run-holding">
          {holdLabel(run.holding.kind, run.holding.name)}
        </small>
      ) : null}
    </td>
  );
}

/** Runs, the most recently active first; each opens its timeline. */
export function RunsTable({
  base,
  runs,
}: {
  base: string;
  runs: RunSummaryDto[];
}) {
  return (
    <DataTable aria-label="Runs" data-tour="activity-table">
      <thead>
        <tr>
          <th scope="col">Run</th>
          <th scope="col">Agents and steps</th>
          <th scope="col">Verdicts</th>
          <th scope="col">Stopped actions</th>
          <th scope="col">Status</th>
          <th scope="col">Last activity</th>
          <DataActionsHeading />
        </tr>
      </thead>
      <tbody className="stagger">
        {runs.map((run) => (
          <tr key={run.id} data-slot="run-row">
            <td>
              <DataTitleLink href={runPath(base, run.id)}>
                {run.key}
              </DataTitleLink>
              <small>
                {[run.agentKey, run.installationName]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </td>
            <StepsCell run={run} />
            <VerdictsCell run={run} />
            <HeldCell run={run} />
            <StatusCell run={run} />
            <td>
              <time dateTime={run.lastActivityAt} suppressHydrationWarning>
                {timeAgo(run.lastActivityAt)}
              </time>
              <small>Started {timeAgo(run.createdAt)}</small>
            </td>
            <DataActionsCell>
              <RowActions
                name={run.key}
                tour="activity-more"
                items={[
                  { label: "Open run", href: runPath(base, run.id) },
                  {
                    label: "See its events",
                    href: `${base}/activity?run=${run.id}`,
                  },
                  "separator",
                  {
                    label: "Copy run ID",
                    copy: run.id,
                    copied: `Copied the ID of ${run.key}.`,
                  },
                ]}
              />
            </DataActionsCell>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}
