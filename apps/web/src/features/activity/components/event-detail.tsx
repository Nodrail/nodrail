import Link from "next/link";
import { Card, CardActions, FactList } from "@/components/app/card";
import { InertJson } from "@/components/app/inert-json";
import { Note } from "@/components/app/note";
import { Button } from "@/components/ui/button";
import type {
  ActivityDetailDto,
  ClientReportDto,
} from "@/contracts/v1/activity";
import { operationLabel } from "@/contracts/v1/policies";
import { HostBadge } from "@/features/runs/components/host-badge";
import { runPath } from "@/features/runs/presentation";
import { formatUtc, timeAgo } from "@/lib/time";
import {
  actorLabel,
  explainEvent,
  mismatchLabel,
  mismatchText,
  reportLabels,
  ruleLabels,
} from "../presentation";

function Report({ report }: { report: ClientReportDto }) {
  return (
    <FactList
      facts={[
        { label: "Reported", value: reportLabels[report.outcome] },
        { label: "Received", value: formatUtc(report.receivedAt) },
        {
          label: "One-time permit",
          value: report.linkedToPermit
            ? "Names a permit Nodrail issued"
            : "Names no permit",
        },
        ...(Object.keys(report.details).length
          ? [{ label: "Details", value: <InertJson value={report.details} /> }]
          : []),
      ]}
    />
  );
}

/** The rule, gate or budget behind a decision. Gates and budgets live on the policy page. */
function ruleFacts(base: string, rule: NonNullable<ActivityDetailDto["rule"]>) {
  const href =
    rule.kind === "rule" ? `${base}/policies/${rule.id}` : `${base}/policies`;
  return [
    {
      label: ruleLabels[rule.kind],
      value: rule.name ? (
        <Link href={href}>{rule.name}</Link>
      ) : (
        "A rule you can't see"
      ),
    },
    ...(rule.revision
      ? [{ label: "Policy set", value: `v${rule.revision}` }]
      : []),
  ];
}

/** The run the action was part of. */
function ActionLinks({
  base,
  action,
}: {
  base: string;
  action: NonNullable<ActivityDetailDto["action"]>;
}) {
  if (!action.run) return null;
  return (
    <CardActions data-tour="event-links">
      <Button asChild variant="outline">
        <Link href={runPath(base, action.run.id)}>
          View run {action.run.key}
        </Link>
      </Button>
    </CardActions>
  );
}

/** What Nodrail recorded about one event, and any client report beside it. */
export function EventDetail({
  base,
  event,
}: {
  base: string;
  event: ActivityDetailDto;
}) {
  const { action, rule } = event;
  const explanation = explainEvent(event);
  return (
    <div className="grid gap-4">
      <Card
        title={event.group === "decision" ? "Decision" : "Change"}
        description="Recorded by Nodrail"
      >
        <HostBadge host={event.host} />
        <div data-tour="event-facts">
          <FactList
            facts={[
              ...(event.agentKey
                ? [
                    {
                      label: "Agent / install",
                      value: [event.agentKey, action?.installationName]
                        .filter(Boolean)
                        .join(" · "),
                    },
                  ]
                : []),
              ...(action
                ? [
                    { label: "Action", value: operationLabel(action) },
                    {
                      label: "Target",
                      value: `${action.resourceKind}: ${action.resource}`,
                    },
                  ]
                : []),
              ...(event.parameters
                ? [
                    {
                      label: "Parameters",
                      value: <InertJson value={event.parameters} />,
                    },
                  ]
                : []),
              { label: "Recorded by", value: actorLabel(event) },
              ...(rule ? ruleFacts(base, rule) : []),
              {
                label: "Time",
                value: `${timeAgo(event.occurredAt)} · ${formatUtc(event.occurredAt)}`,
              },
              ...(action
                ? [{ label: "Request ID", value: action.reference }]
                : []),
            ]}
          />
        </div>
        {explanation ? (
          <Note tone="plain" data-tour="event-why">
            {explanation}
          </Note>
        ) : null}
        {action ? <ActionLinks base={base} action={action} /> : null}
      </Card>
      {action ? (
        <div data-tour="event-report">
          <Card
            title="Client report"
            description="Sent by your integration. A report is not independent verification."
          >
            {event.latestReport?.mismatch ? (
              <Note tone="warning" data-slot="report-mismatch">
                <strong className="block font-semibold">{mismatchLabel}</strong>
                {mismatchText}
              </Note>
            ) : null}
            {event.reports.length === 0 ? (
              <Note tone="plain">No client report for this request.</Note>
            ) : (
              event.reports.map((report) => (
                <Report key={report.id} report={report} />
              ))
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
