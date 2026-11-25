import { FactList } from "@/components/app/card";
import { FormHint } from "@/components/app/note";
import { StatusBadge } from "@/components/app/status-badge";
import type {
  ContractEventDto,
  SafeValidationIssue,
} from "@/contracts/v1/contract-events";
import {
  availabilityLabels,
  eventState,
  executionLabels,
  surfaceNouns,
  issueLabels,
  producerLabels,
  shortDigest,
  validatedByText,
  valueText,
} from "../presentation";

/**
 * One receipt checked against its declared contract, as Cloud may show it:
 * its state, who produced and checked it, the contract revision, and each
 * declared field as a reported value, "not provided" or "redacted". A
 * redacted field is a name the contract declares; its value never left the
 * machine, and nothing here says whether it was filled in.
 */

type Row = {
  path: string;
  state: "value" | "absent" | "redacted";
  text: string;
};

/** Reported leaves by dotted path; lists are shown whole. */
function leaves(value: unknown, prefix: string): Row[] {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return [{ path: prefix, state: "value", text: valueText(value) }];
  return Object.entries(value).flatMap(([key, inner]) =>
    leaves(inner, prefix ? `${prefix}.${key}` : key),
  );
}

function fieldRows(event: ContractEventDto): Row[] {
  return [
    ...leaves(event.fields, ""),
    ...event.absent.map((path) => ({
      path,
      state: "absent" as const,
      text: "Not provided",
    })),
    ...event.redacted.map((path) => ({
      path,
      state: "redacted" as const,
      text: "Redacted · not reported",
    })),
  ]
    .filter((row) => row.path !== "")
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function IssueList({
  issues,
  count,
}: {
  issues: SafeValidationIssue[];
  count: number;
}) {
  return (
    <ul data-slot="contract-issues" className="grid gap-0.5 text-ui">
      {issues.map((issue, index) => (
        <li key={`${issue.path ?? "-"}-${index}`}>
          <code>{issue.path ?? "a property that isn't reported"}</code>
          {": "}
          {issueLabels[issue.code]}
        </li>
      ))}
      {count > issues.length ? (
        <li className="text-muted-foreground">
          and {count - issues.length} more
        </li>
      ) : null}
    </ul>
  );
}

function Fields({ event }: { event: ContractEventDto }) {
  if (event.capture !== "captured") return null;
  if (event.projectionValidation === "invalid")
    return (
      <FormHint>
        The reported values didn&apos;t match the contract&apos;s reporting
        projection, so none were kept.
      </FormHint>
    );
  const rows = fieldRows(event);
  if (rows.length === 0)
    return <FormHint>The contract reports none of these fields.</FormHint>;
  return (
    <dl data-slot="contract-fields" className="grid gap-0.5 text-ui">
      {rows.map((row) => (
        <div key={row.path} data-state={row.state} className="flex gap-2">
          <dt>
            <code>{row.path}</code>
          </dt>
          <dd
            className={
              row.state === "value"
                ? "[overflow-wrap:anywhere] text-body"
                : "text-muted-foreground italic"
            }
          >
            {row.text}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReceiptInspector({ event }: { event: ContractEventDto }) {
  const state = eventState(event);
  const { provenance, contract } = event;
  return (
    <div data-slot="receipt-inspector" className="grid gap-2">
      <FactList
        facts={[
          {
            label: surfaceNouns[event.surface],
            value: <StatusBadge tone={state.tone}>{state.label}</StatusBadge>,
          },
          {
            label: "Contract",
            value: `${contract.name} · ${shortDigest(contract.digest)} · ${availabilityLabels[contract.availability]}`,
          },
          {
            label: "Producer",
            value: `${producerLabels[provenance.producerClass]} · ${provenance.sourceLabel}`,
          },
          { label: "Checked", value: validatedByText(event) },
          ...(event.findingsCount === null
            ? []
            : [{ label: "Findings", value: String(event.findingsCount) }]),
          ...(event.execution === null
            ? []
            : [{ label: "Provider", value: executionLabels[event.execution] }]),
          ...(event.delivered === null
            ? []
            : [
                {
                  label: "Delivered",
                  value: event.delivered ? "Handed on" : "Not handed on",
                },
              ]),
        ]}
      />
      {event.validation === "invalid" ? (
        <IssueList issues={event.issues} count={event.issueCount} />
      ) : null}
      <Fields event={event} />
      {event.authorizes ? null : (
        <FormHint>
          {provenance.authority === "reported"
            ? "Local report: it can't satisfy a Cloud gate or allow anything."
            : "Not usable by a Cloud gate: it wasn't valid when Cloud checked it."}
        </FormHint>
      )}
    </div>
  );
}
