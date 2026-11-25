import { EmptyState } from "@/components/app/card";
import { ExchangeList } from "@/features/contracts/components/exchange-list";
import {
  reportedReceiptLabels,
  shortDigest,
} from "@/features/contracts/presentation";
import { DataTable, DataTitle, ListSummary } from "@/components/app/data-table";
import { StatusBadge } from "@/components/app/status-badge";
import type { Tone } from "@/components/app/tones";
import { cardTitle } from "@/components/app/styles";
import {
  LOCAL_SOURCE_LABEL,
  type LocalRunDto,
  type ReportedDecisionDto,
} from "@/contracts/v1/reporting";
import { readForPage } from "@/features/shell/load-view";
import { timeAgo } from "@/lib/time";
import {
  listLocalRuns,
  listReportedDecisions,
} from "@/server/modules/reporting/list";

/**
 * What installations reported their local hooks did. Evidence of local
 * enforcement only: there is nothing to pause or retry here, and
 * no control on this view acts on a local hook.
 */

const decisions: Record<
  ReportedDecisionDto["decision"],
  { tone: Tone; label: string }
> = {
  allow: { tone: "success", label: "Allowed locally" },
  deny: { tone: "danger", label: "Denied locally" },
};

const short = (value: string | null) =>
  value ? value.slice(0, 12) : "unknown";

function ProjectCell({
  row,
}: {
  row: { project: string; projectBound: boolean };
}) {
  return (
    <>
      <DataTitle>{row.project}</DataTitle>
      <small>
        {row.projectBound
          ? LOCAL_SOURCE_LABEL
          : `${LOCAL_SOURCE_LABEL} · unbound: no project id`}
      </small>
    </>
  );
}

function DecisionRow({ row }: { row: ReportedDecisionDto }) {
  const looks = decisions[row.decision];
  return (
    <tr data-slot="reported-decision">
      <td>
        <ProjectCell row={row} />
      </td>
      <td>
        {row.tool && row.operation
          ? `${row.tool} ${row.operation}`
          : "Unknown call"}
        <small>{row.agent ? `As ${row.agent}` : "Agent unknown"}</small>
      </td>
      <td>
        <StatusBadge tone={looks.tone}>{looks.label}</StatusBadge>
        <small>{row.rule ? `Rule ${row.rule}` : "No rule matched"}</small>
      </td>
      <td>
        {row.mine ? "You" : row.person}
        <small>
          {row.machine ? `Machine ${row.machine}` : "Machine unknown"} · policy{" "}
          {short(row.policyRevision)}
        </small>
      </td>
      <td>{timeAgo(row.occurredAt)}</td>
    </tr>
  );
}

function stepText(step: LocalRunDto["steps"][number]) {
  if (!step.finishedAt) return "Not finished, or not reported";
  const verdict = step.verdict
    ? `verdict ${step.verdict}`
    : "no verdict reported";
  const findings = step.findings === null ? "" : `, ${step.findings} findings`;
  return `${verdict}${findings}`;
}

function RunItem({ run }: { run: LocalRunDto }) {
  return (
    <li data-slot="local-run" className="rounded-md border p-3">
      <DataTitle>
        {run.project} · {run.host}
      </DataTitle>
      <small className="block text-muted-foreground">
        {run.machine ? `Machine ${run.machine.slice(0, 8)}` : "Machine unknown"}
        {run.projectBound ? "" : " · unbound: no project id"}
      </small>
      <small className="block text-muted-foreground">
        {LOCAL_SOURCE_LABEL} · {run.mine ? "you" : run.person} · last reported{" "}
        {timeAgo(run.lastAt)} · {run.actions.allowed} allowed,{" "}
        {run.actions.denied} denied locally
      </small>
      <ul className="mt-2 grid gap-1 text-sm">
        {run.steps.length === 0 ? <li>No steps reported.</li> : null}
        {run.steps.map((step) => (
          <li key={step.step}>
            <strong>{step.agent}</strong>: {stepText(step)}
            <ExchangeList
              events={[
                ...step.exchanges,
                ...(step.receipt ? [step.receipt] : []),
              ]}
            />
            {!step.receipt && step.receiptState && step.receiptContract ? (
              <small
                data-slot="reported-receipt"
                data-state={step.receiptState}
                className="block text-muted-foreground"
              >
                Receipt: {reportedReceiptLabels[step.receiptState]} · contract{" "}
                <code>{shortDigest(step.receiptContract)}</code>
              </small>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

/** Reported decisions and local runs, or why there are none to show. */
export async function LocalReports({
  workspace,
  environment,
}: {
  workspace: string;
  environment: string;
}) {
  const [rows, runs] = await Promise.all([
    readForPage(workspace, (context) =>
      listReportedDecisions(context, environment),
    ),
    readForPage(workspace, (context) => listLocalRuns(context, environment)),
  ]);
  if (rows.length === 0 && runs.length === 0)
    return (
      <EmptyState title="Nothing reported yet">
        Send traces from a project&apos;s <code>telemetry:</code> settings or an
        OpenTelemetry collector to <code>/api/v1/otlp/v1/traces</code> with a
        reporting token. Admins and policy managers can see reports from
        everyone.
      </EmptyState>
    );
  return (
    <>
      <ListSummary data-tour="local-reports">
        Received as OpenTelemetry traces.
      </ListSummary>
      <h2 className={cardTitle}>Decisions</h2>
      {rows.length === 0 ? (
        <p className="mb-6 text-sm text-muted-foreground">
          Runs were reported, but no decisions yet.
        </p>
      ) : (
        <DataTable aria-label="Reported decisions" className="mb-6">
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Call</th>
              <th scope="col">Decision</th>
              <th scope="col">Reported by</th>
              <th scope="col">When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DecisionRow key={row.id} row={row} />
            ))}
          </tbody>
        </DataTable>
      )}
      <h2 className={cardTitle}>Local runs</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No local runs reported.</p>
      ) : (
        <ul className="grid gap-2">
          {runs.map((run) => (
            <RunItem key={run.id} run={run} />
          ))}
        </ul>
      )}
    </>
  );
}
