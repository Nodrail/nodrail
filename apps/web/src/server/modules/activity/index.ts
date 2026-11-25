import "server-only";
import { z } from "zod";
import type {
  ActivityDetailDto,
  ActivityPageDto,
  ClientReportDto,
} from "@/contracts/v1/activity";
import { activityQuery } from "@/contracts/v1/activity-query";
import {
  AppError,
  parseInput,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";
import { eventRow, eventSource, queryEvents, toEvent } from "./source";

const PAGE_SIZE = 50;
const MAX_REPORTS = 20;

/** One page of events for the filters in the URL, newest first. */
export async function listActivity(
  context: WorkspaceContext,
  environmentSlug: string,
  rawQuery: unknown,
  pageSize = PAGE_SIZE,
): Promise<ActivityPageDto> {
  const query = parseInput(activityQuery, rawQuery);
  const environment = await findEnvironment(context, environmentSlug);
  return queryEvents(context, environment.id, query, { limit: pageSize });
}

const detailRow = z.object({
  params_safe: z.record(z.string(), z.unknown()),
});

const reportRow = z.object({
  id: z.uuid(),
  outcome: z.enum(["success", "failure", "unknown"]),
  received_at: z.date(),
  permit_id: z.uuid().nullable(),
  details_safe: z.record(z.string(), z.unknown()),
});

export async function getActivityEvent(
  context: WorkspaceContext,
  environmentSlug: string,
  eventId: string,
): Promise<ActivityDetailDto> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError("NOT_FOUND");
  const { manager, workspaceId } = context;
  const environment = await findEnvironment(context, environmentSlug);
  const [row] = parseRows(
    eventRow,
    await manager.query(`${eventSource} WHERE ev.id = $3`, [
      workspaceId,
      environment.id,
      eventId,
    ]),
  );
  if (!row) throw new AppError("NOT_FOUND");
  if (!row.action_id) return { ...toEvent(row), parameters: null, reports: [] };

  const [action] = parseRows(
    detailRow,
    await manager.query(
      `SELECT params_safe FROM nodrail.action_requests
       WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, row.action_id],
    ),
  );
  const reports = parseRows(
    reportRow,
    await manager.query(
      `SELECT id, outcome, received_at, permit_id, details_safe
       FROM nodrail.client_reports
       WHERE workspace_id = $1 AND action_request_id = $2
       ORDER BY received_at DESC, id DESC
       LIMIT $3`,
      [workspaceId, row.action_id, MAX_REPORTS],
    ),
  );
  return {
    ...toEvent(row),
    parameters: action?.params_safe ?? null,
    reports: reports.map((report): ClientReportDto => ({
      id: report.id,
      outcome: report.outcome,
      receivedAt: report.received_at.toISOString(),
      linkedToPermit: report.permit_id !== null,
      details: report.details_safe,
    })),
  };
}
