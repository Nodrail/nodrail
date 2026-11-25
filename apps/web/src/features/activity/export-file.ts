import type { ActivityEventDto } from "@/contracts/v1/activity";
import type { ExportFormat } from "@/contracts/v1/activity-query";
import { toCsv } from "@/lib/csv";
import { actorLabel, ruleLabels } from "./presentation";

/** The export's columns, in order. Renaming one breaks people's spreadsheets. */
export const exportColumns = [
  "time_utc",
  "agent",
  "installation",
  "tool",
  "operation",
  "resource",
  "outcome",
  "decided_by",
  "reason",
  "run",
  "request_id",
] as const;

type ExportRow = Record<(typeof exportColumns)[number], string>;

/** What the event was, then the rule, gate or budget, or what it changed. */
function reasonOf(event: ActivityEventDto) {
  const rule = event.rule
    ? `${ruleLabels[event.rule.kind]} ${event.rule.name ?? "you can't see"}`
    : null;
  const what = event.action ? null : (event.subject ?? event.detail);
  return [event.label, rule, what].filter(Boolean).join(" · ");
}

/** One event as one row. Agent-supplied text is passed on as it was sent. */
export function exportRow(event: ActivityEventDto): ExportRow {
  const { action } = event;
  return {
    time_utc: event.occurredAt,
    agent: event.agentKey ?? "",
    installation: action?.installationName ?? "",
    tool: action?.toolKey ?? "",
    operation: action?.operationKey ?? "",
    resource: action?.resource ?? "",
    outcome: event.outcome,
    decided_by: actorLabel(event),
    reason: reasonOf(event),
    run: action?.run?.key ?? "",
    request_id: action?.reference ?? "",
  };
}

/** The file's text: CSV safe to open in a spreadsheet, or JSON with its limits. */
export function exportText(
  format: ExportFormat,
  items: ActivityEventDto[],
  meta: { capped: boolean; limit: number },
) {
  const rows = items.map(exportRow);
  if (format === "csv")
    return toCsv(
      exportColumns,
      rows.map((row) => exportColumns.map((column) => row[column])),
    );
  return `${JSON.stringify(
    {
      columns: exportColumns,
      count: rows.length,
      capped: meta.capped,
      limit: meta.limit,
      events: rows,
    },
    null,
    2,
  )}\n`;
}

export const exportTypes: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};
