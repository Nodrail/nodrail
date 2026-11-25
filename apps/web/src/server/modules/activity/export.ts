import "server-only";
import {
  activityQuery,
  EXPORT_LIMIT,
  type ActivityQuery,
  type ExportFormat,
} from "@/contracts/v1/activity-query";
import { parseInput, type WorkspaceContext } from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";
import { findEnvironment } from "@/server/modules/workspaces";
import { queryEvents } from "./source";

/**
 * The newest events matching the filters, up to the export limit. Read as the
 * list is, so a person exports only what their own Activity shows them.
 */
export async function exportActivity(
  context: WorkspaceContext,
  environmentSlug: string,
  rawQuery: unknown,
  limit = EXPORT_LIMIT,
) {
  const query = {
    ...parseInput(activityQuery, rawQuery),
    // An export starts from the newest, whatever page the list is on.
    cursor: undefined,
  };
  const environment = await findEnvironment(context, environmentSlug);
  const { items, nextCursor } = await queryEvents(
    context,
    environment.id,
    query,
    { limit },
  );
  return { environmentId: environment.id, query, items, capped: !!nextCursor };
}

/** The filters that were set, as recorded with the export. */
function setFilters({ cursor: _cursor, ...query }: ActivityQuery) {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value && value !== "all"),
  );
}

/** Who exported what: the format, the filters and how many events. */
export function recordActivityExport(
  context: WorkspaceContext,
  entry: {
    environmentId: string;
    format: ExportFormat;
    query: ActivityQuery;
    rows: number;
    capped: boolean;
  },
) {
  const filters = setFilters(entry.query);
  const described = Object.entries(filters)
    .map(([name, value]) => `${name}: ${value}`)
    .join(", ");
  return recordAudit(context, {
    eventType: "activity.exported",
    decisionCode: "activity_exported",
    environmentId: entry.environmentId,
    payload: {
      subject: `Activity as ${entry.format.toUpperCase()}`,
      detail: `${entry.rows} events${entry.capped ? " (limit reached)" : ""} · ${described || "no filters"}`,
      format: entry.format,
      rows: entry.rows,
      capped: entry.capped,
      filters,
    },
  });
}
