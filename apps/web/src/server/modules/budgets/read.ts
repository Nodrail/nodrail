import "server-only";
import type { NumericBudget } from "@nodrail/sdk";
import { dayWindow, type LimitState } from "@nodrail/sdk/ledger";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { seesWholeWorkspace } from "@/contracts/v1/access";
import {
  budgetLabelText,
  reservationsQuery,
  type BudgetLimitDto,
  type BudgetReservationDto,
  type BudgetStatusDto,
  type BudgetWindowDto,
} from "@/contracts/v1/budgets";
import {
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { storedRunPolicy } from "@/server/modules/runs/policy";
import { findEnvironment } from "@/server/modules/workspaces";
import type { Covering } from "./reserve";

// What numeric budgets stand at in Cloud: for a decision (the totals of a
// window, read under its lock at the permit), and for people (live budgets,
// their windows and the reservations whose outcome isn't known).

type Scope = { manager: EntityManager; workspaceId: string };

/** A bigint total as a number, or null past what can be added up safely. */
const safe = (text: string | number) => {
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
};

/**
 * Reservations a window counts. A call with no report is shown as unknown
 * once `unknown_after` has passed; for a measured budget it then holds like
 * one reported unknown. An expired host lease only stops counting if it never started.
 */
const ACTIVE_LEASE =
  "r.lease_id IS NOT NULL AND (r.started_at IS NOT NULL OR r.unknown_after > statement_timestamp())";
const TOTALS = `
  COALESCE(SUM(r.amount) FILTER (WHERE r.state = 'consumed'), 0)::text AS consumed,
  COALESCE(SUM(r.amount) FILTER (WHERE r.state = 'reserved' AND (r.lease_id IS NULL OR (${ACTIVE_LEASE}))), 0)::text AS reserved,
  COALESCE(SUM(r.amount) FILTER (WHERE r.state = 'unknown'), 0)::text AS unknown,
  COALESCE(SUM(r.measured) FILTER (WHERE r.state = 'consumed'), 0)::text AS measured,
  (COUNT(*) FILTER (WHERE r.source = 'measured' AND (
     r.state = 'unknown'
     OR (r.state = 'consumed' AND r.measured IS NULL)
     OR (r.state = 'reserved' AND CASE WHEN r.lease_id IS NULL
       THEN r.unknown_after <= statement_timestamp() ELSE ${ACTIVE_LEASE} END))))::int AS unread`;

const totalsRow = z.object({
  consumed: z.string(),
  reserved: z.string(),
  unknown: z.string(),
  measured: z.string(),
  unread: z.number(),
});
type Totals = z.infer<typeof totalsRow>;
const NONE: Totals = {
  consumed: "0",
  reserved: "0",
  unknown: "0",
  measured: "0",
  unread: 0,
};

async function windowTotals(
  { manager, workspaceId }: Scope,
  environmentId: string,
  budgetKey: string,
  windowKey: string,
): Promise<Totals> {
  const [row] = parseRows(
    totalsRow,
    await manager.query(
      `SELECT ${TOTALS}
       FROM nodrail.budget_windows w
       JOIN nodrail.budget_reservations r
         ON r.workspace_id = w.workspace_id AND r.window_id = w.id
       WHERE w.workspace_id = $1 AND w.environment_id = $2
         AND w.budget_key = $3 AND w.window_key = $4`,
      [workspaceId, environmentId, budgetKey, windowKey],
    ),
  );
  return row ?? NONE;
}

/** A budget's numbers before anything is counted: none used yet. */
function base(budget: NumericBudget, now: Date) {
  const { id, name, label, unit, limit, effect, timezone } = budget;
  const counted = { used: 0, reserved: 0, unknown: 0, unread: 0 };
  const resets = timezone ? dayWindow(now, timezone).end.toISOString() : null;
  return {
    id,
    name,
    label,
    unit,
    limit,
    effect,
    ...counted,
    amount: null,
    resets,
  };
}

/**
 * Where one budget stands for a call, as the engine's ledger would say:
 * admission counts consumed, reserved and unknown amounts plus this call's;
 * measured stops further work at the limit, and an unread call holds.
 * A total that can't be added up safely is unknown, and holds.
 */
function standing(covering: Covering, totals: Totals, now: Date): LimitState {
  const start = base(covering.budget, now);
  return covering.budget.source === "measured"
    ? measuredStanding(start, totals)
    : admissionStanding(start, totals, covering.amount);
}

/** A sum, or null when a part is unknown or it can't be added up safely. */
function add(...parts: (number | null)[]): number | null {
  let total = 0;
  for (const part of parts) {
    if (part === null) return null;
    total += part;
  }
  return safe(total);
}

type Start = ReturnType<typeof base>;

function measuredStanding(start: Start, totals: Totals): LimitState {
  const used = safe(totals.measured);
  const state =
    used === null || totals.unread > 0
      ? "unknown"
      : used >= start.limit
        ? "over"
        : "ok";
  return { ...start, used: used ?? 0, unread: totals.unread, state };
}

function admissionStanding(
  start: Start,
  totals: Totals,
  amount: number | null,
): LimitState {
  const reserved = safe(totals.reserved);
  const unknown = safe(totals.unknown);
  const used = add(safe(totals.consumed), reserved, unknown);
  const total = add(used, amount);
  return {
    ...start,
    used: used ?? 0,
    reserved: reserved ?? 0,
    unknown: unknown ?? 0,
    amount,
    state: total === null ? "unknown" : total > start.limit ? "over" : "ok",
  };
}

/** Where each covering budget stands now, from its window's reservations. */
export async function standingsOf(
  scope: Scope,
  environmentId: string,
  coverings: Covering[],
  now: Date,
): Promise<LimitState[]> {
  const standings: LimitState[] = [];
  for (const covering of coverings) {
    const { budget, window } = covering;
    if (!window) {
      standings.push({ ...base(budget, now), state: "no_run" });
      continue;
    }
    const totals = await windowTotals(
      scope,
      environmentId,
      budget.id,
      window.key,
    );
    standings.push(standing(covering, totals, now));
  }
  return standings;
}

export const limitDto = (budget: NumericBudget): BudgetLimitDto => ({
  id: budget.id,
  name: budget.name,
  label: budget.label,
  labelText: budgetLabelText(budget.label),
  source: budget.source,
  measure: budget.measure,
  unit: budget.unit,
  limit: budget.limit,
  per: budget.per,
  timezone: budget.timezone,
  across: budget.across,
  effect: budget.effect,
  agent: budget.agent,
});

const reservationRow = z.object({
  id: z.string(),
  budget_key: z.string(),
  window_id: z.string(),
  action_request_id: z.string().nullable(),
  tool_key: z.string().nullable(),
  operation_key: z.string().nullable(),
  source: z.enum(["admission", "measured"]),
  unit: z.string(),
  amount: z.string().nullable(),
  measured_path: z.string().nullable(),
  measured: z.string().nullable(),
  state: z.enum(["reserved", "consumed", "released", "unknown"]),
  shown_as: z.enum(["reserved", "consumed", "released", "unknown"]),
  settled_by: z.enum(["runtime", "person"]).nullable(),
  settled_at: z.date().nullable(),
  note: z.string().nullable(),
  created_at: z.date(),
});

const SHOWN_AS = `CASE WHEN r.state = 'reserved'
  AND r.unknown_after <= statement_timestamp()
  THEN CASE WHEN r.lease_id IS NULL OR r.started_at IS NOT NULL THEN 'unknown' ELSE 'released' END
  ELSE r.state END`;

const RESERVATION_SELECT = `
  SELECT r.id, r.budget_key, r.window_id, r.action_request_id, ar.tool_key,
         ar.operation_key, r.source, r.unit, r.amount::text AS amount,
         r.measured_path, r.measured::text AS measured, r.state,
         ${SHOWN_AS} AS shown_as, r.settled_by, r.settled_at, r.note,
         r.created_at
  FROM nodrail.budget_reservations r
  LEFT JOIN nodrail.action_requests ar
    ON ar.workspace_id = r.workspace_id AND ar.id = r.action_request_id`;

const toReservation = (
  row: z.infer<typeof reservationRow>,
): BudgetReservationDto => ({
  id: row.id,
  budgetId: row.budget_key,
  windowId: row.window_id,
  actionId: row.action_request_id,
  tool: row.tool_key,
  operation: row.operation_key,
  source: row.source,
  unit: row.unit,
  amount: row.amount === null ? null : safe(row.amount),
  measuredPath: row.measured_path,
  measured: row.measured === null ? null : safe(row.measured),
  state: row.state,
  shownAs: row.shown_as,
  settledBy: row.settled_by,
  settledAt: row.settled_at?.toISOString() ?? null,
  note: row.note,
  createdAt: row.created_at.toISOString(),
});

/** One reservation in the environment, locked for a person's word on it. */
export async function lockedReservation(
  { manager, workspaceId }: Scope,
  environmentId: string,
  id: string,
) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = parseRows(
    reservationRow,
    await manager.query(
      `${RESERVATION_SELECT}
       WHERE r.workspace_id = $1 AND r.environment_id = $2 AND r.id = $3
       FOR UPDATE OF r`,
      [workspaceId, environmentId, id],
    ),
  );
  return row ? toReservation(row) : null;
}

/** Most reservations one list returns, newest first. */
const PAGE = 200;

/**
 * Reservations in an environment, newest first, by the state people see.
 * Only admins and policy managers see the whole environment's; anyone else
 * sees those of the agents they're assigned, as Runs does.
 */
export async function listReservations(
  context: WorkspaceContext,
  environmentSlug: string,
  rawQuery: unknown = {},
): Promise<BudgetReservationDto[]> {
  requireCapability(context, "workspace:read");
  const query = parseInput(reservationsQuery, rawQuery);
  const environment = await findEnvironment(context, environmentSlug);
  return reservationsIn(context, environment.id, query);
}

async function reservationsIn(
  context: WorkspaceContext,
  environmentId: string,
  query: { state?: string; action?: string },
) {
  const rows = parseRows(
    reservationRow,
    await context.manager.query(
      `${RESERVATION_SELECT}
       WHERE r.workspace_id = $1 AND r.environment_id = $2
         AND ($3::text IS NULL OR ${SHOWN_AS} = $3)
         AND ($4::uuid IS NULL OR r.action_request_id = $4)
         AND ($5 OR ar.agent_id IN (
           SELECT agent_id FROM nodrail.agent_members
           WHERE workspace_id = $1 AND user_id = $6))
       ORDER BY r.created_at DESC, r.id
       LIMIT ${PAGE}`,
      [
        context.workspaceId,
        environmentId,
        query.state ?? null,
        query.action ?? null,
        seesWholeWorkspace(context.role),
        context.principal.userId,
      ],
    ),
  );
  return rows.map(toReservation);
}

const windowRow = z.object({
  id: z.string(),
  budget_key: z.string(),
  per: z.enum(["step", "run", "day"]),
  across: z.enum(["run", "environment"]),
  run_key: z.string().nullable(),
  step_key: z.string().nullable(),
  day: z.string().nullable(),
  timezone: z.string().nullable(),
  starts_at: z.date().nullable(),
  ends_at: z.date().nullable(),
  unit: z.string(),
  ...totalsRow.shape,
});

const toWindow = (row: z.infer<typeof windowRow>): BudgetWindowDto => ({
  id: row.id,
  budgetId: row.budget_key,
  per: row.per,
  across: row.across,
  runKey: row.run_key,
  stepKey: row.step_key,
  day: row.day,
  timezone: row.timezone,
  startsAt: row.starts_at?.toISOString() ?? null,
  endsAt: row.ends_at?.toISOString() ?? null,
  unit: row.unit,
  consumed: safe(row.consumed) ?? Number.MAX_SAFE_INTEGER,
  reserved: safe(row.reserved) ?? Number.MAX_SAFE_INTEGER,
  unknown: safe(row.unknown) ?? Number.MAX_SAFE_INTEGER,
  measured: safe(row.measured) ?? Number.MAX_SAFE_INTEGER,
  unread: row.unread,
});

/**
 * The live version's numeric budgets in an environment, their windows still
 * open (a day not yet over; run and step windows most recently used first)
 * and the reservations shown as unknown, which reconcile is for. Windows
 * aggregate every agent's calls, so only admins and policy managers see them.
 */
export async function budgetStatus(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<BudgetStatusDto> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const limits = (await storedRunPolicy(context, environment.id)).limits ?? [];
  if (!seesWholeWorkspace(context.role))
    return { limits: limits.map(limitDto), windows: [], unknown: [] };
  const windows = parseRows(
    windowRow,
    await context.manager.query(
      `SELECT w.id, w.budget_key, w.per, w.across, w.run_key, w.step_key, w.day,
              w.timezone, w.starts_at, w.ends_at, w.unit, ${TOTALS}
       FROM nodrail.budget_windows w
       LEFT JOIN nodrail.budget_reservations r
         ON r.workspace_id = w.workspace_id AND r.window_id = w.id
       WHERE w.workspace_id = $1 AND w.environment_id = $2
         AND w.budget_key = ANY($3::text[])
         AND (w.ends_at IS NULL OR w.ends_at > clock_timestamp())
       GROUP BY w.id
       ORDER BY w.touched_at DESC
       LIMIT ${PAGE}`,
      [context.workspaceId, environment.id, limits.map((budget) => budget.id)],
    ),
  );
  return {
    limits: limits.map(limitDto),
    windows: windows.map(toWindow),
    unknown: (
      await reservationsIn(context, environment.id, { state: "unknown" })
    ).reverse(),
  };
}
