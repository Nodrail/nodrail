import "server-only";
import {
  limitsOf,
  type NumericBudget,
  type PolicyDocument,
} from "@nodrail/sdk";
import {
  covers,
  dayWindow,
  explainLimit,
  type LimitState,
} from "@nodrail/sdk/ledger";
import type { ActionDescriptor } from "@nodrail/sdk/protocol";
import type { EntityManager } from "typeorm";
import { UNKNOWN_AFTER_MINUTES } from "@/contracts/v1/budgets";
import { AppError, type RuntimeContext } from "@/server/db/context";
import type { Place, RunVerdict } from "@/server/modules/runs/history";
import { standingsOf } from "./read";

// Admission in Cloud: which numeric budgets cover a call, the
// window each counts it in, and, at the permit, the reservations a call that
// goes ahead sets aside. The permit holds its action, then its run, then
// these windows in key order, so mixed budgets never wait on each other in
// a cycle and two calls never both take a budget's last slot.

/** The main agent's name, as the engine calls actions outside any step. */
const MAIN = "main";

/** Where one budget counts a call: a run, a step, a day, or the environment. */
export type BudgetPlace = Pick<Place, "key" | "step"> & {
  runId: string | null;
};

export type WindowSpec = {
  key: string;
  per: NumericBudget["per"];
  across: NumericBudget["across"];
  runId: string | null;
  runKey: string | null;
  stepKey: string | null;
  day: string | null;
  timezone: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

/** A budget that covers the call, where it counts it, and what it adds. */
export type Covering = {
  budget: NumericBudget;
  /** Null when it counts in a run and the call has none. */
  window: WindowSpec | null;
  /** Known before the call (admission); null when it can't be. */
  amount: number | null;
  /** The window's row, once a permit locked it. */
  windowId?: string;
};

/**
 * The window `budget` counts a call in. A run's windows are the run's own
 * (its installation's); `across: environment` is everyone's in the
 * environment: a day there, or a run by its key on any machine.
 */
export function windowFor(
  budget: NumericBudget,
  place: BudgetPlace | null,
  now: Date,
): WindowSpec | null {
  const day = budget.timezone ? dayWindow(now, budget.timezone) : null;
  const scope = scopeOf(budget, place, day?.key ?? null);
  if (!scope) return null;
  return {
    ...scope,
    per: budget.per,
    across: budget.across,
    day: day?.key ?? null,
    timezone: day ? budget.timezone : null,
    startsAt: day?.start ?? null,
    endsAt: day?.end ?? null,
  };
}

/** The window's key and the run and step it counts, or null without a run. */
function scopeOf(
  budget: NumericBudget,
  place: BudgetPlace | null,
  day: string | null,
) {
  const none = { runId: null, runKey: null, stepKey: null };
  if (budget.across === "environment" && day)
    return { ...none, key: `day:${day}` };
  if (!place) return null;
  if (budget.across === "environment")
    return { ...none, key: `run-key:${place.key}`, runKey: place.key };
  if (!place.runId) return null;
  const stepKey = budget.per === "step" ? (place.step?.id ?? "") : null;
  const run =
    stepKey === null ? `run:${place.runId}` : `step:${place.runId}:${stepKey}`;
  return {
    key: day ? `${run}:day:${day}` : run,
    runId: place.runId,
    runKey: place.key,
    stepKey,
  };
}

/** The value at a dotted path of the call's params, as the installation sent it. */
function valueAt(params: BudgetCall["params"], path: string): unknown {
  let current: unknown = params;
  for (const part of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    )
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * What a call adds before it runs: 1 for a count, the reported input amount
 * for a sum of an `input.` path (`params.input`), else null. A classified
 * or missing amount is unknown, and an unknown amount holds.
 */
function admissionAmount(budget: NumericBudget, params: BudgetCall["params"]) {
  const { measure } = budget;
  if (budget.source !== "admission") return null;
  if (measure.kind === "count") return 1;
  if (measure.kind !== "sum") return null;
  const value = valueAt(params, measure.path);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** The call as a budget reads it: what it is, and the params it was sent with. */
export type BudgetCall = Pick<ActionDescriptor, "tool" | "operation"> & {
  params: Record<string, unknown>;
};

/** Where budgets are counted: the environment's windows, in one workspace. */
export type BudgetScope = {
  manager: EntityManager;
  workspaceId: string;
  environmentId: string;
};

/** Every numeric budget of the version that covers this call. */
export function coveringLimits(
  document: PolicyDocument,
  descriptor: BudgetCall,
  place: Place | null,
  now: Date,
): Covering[] {
  const agent = place?.step?.agent ?? MAIN;
  const call = {
    tool: descriptor.tool,
    operation: descriptor.operation,
    values: null,
  };
  return limitsOf(document)
    .filter((budget) => covers(budget, call, agent))
    .map((budget) => ({
      budget,
      window: windowFor(budget, place, now),
      amount: admissionAmount(budget, descriptor.params),
    }));
}

/** The order windows are always locked in: by budget, then window. */
const lockOrder = (a: Covering, b: Covering) => {
  const left = `${a.budget.id}\u0000${a.window?.key ?? ""}`;
  const right = `${b.budget.id}\u0000${b.window?.key ?? ""}`;
  return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * Creates each window row the call counts in, if new, and locks it, one at
 * a time in key order. Called holding the action and its run.
 */
async function lockWindows(context: BudgetScope, coverings: Covering[]) {
  const { manager, workspaceId, environmentId } = context;
  for (const covering of [...coverings].sort(lockOrder)) {
    const { budget, window } = covering;
    if (!window) continue;
    await manager.query(
      `INSERT INTO nodrail.budget_windows
         (workspace_id, environment_id, budget_key, window_key, per, across,
          run_id, run_key, step_key, day, timezone, starts_at, ends_at, unit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (workspace_id, environment_id, budget_key, window_key)
       DO NOTHING`,
      [
        workspaceId,
        environmentId,
        budget.id,
        window.key,
        window.per,
        window.across,
        window.runId,
        window.runKey,
        window.stepKey,
        window.day,
        window.timezone,
        window.startsAt,
        window.endsAt,
        budget.unit,
      ],
    );
    const [locked]: { id: string; ends_at: Date | null }[] =
      await manager.query(
        `WITH touched AS (
         UPDATE nodrail.budget_windows SET touched_at = clock_timestamp()
         WHERE workspace_id = $1 AND environment_id = $2
           AND budget_key = $3 AND window_key = $4
         RETURNING id, ends_at)
       SELECT id, ends_at FROM touched`,
        [workspaceId, environmentId, budget.id, window.key],
      );
    if (!locked) throw new AppError("BUSY");
    covering.windowId = locked.id;
    window.endsAt = locked.ends_at;
  }
}

export type Admission = { coverings: Covering[]; standings: LimitState[] };

/**
 * Where each numeric budget covering the call stands. `lock` (the permit):
 * its windows are created and locked first, so what it reads stays true
 * until the permit's transaction ends.
 */
export async function admit(
  context: BudgetScope,
  {
    document,
    descriptor,
    place,
    lock,
  }: {
    document: PolicyDocument;
    descriptor: BudgetCall;
    place: Place | null;
    lock: boolean;
  },
): Promise<Admission> {
  const now = new Date();
  const coverings = coveringLimits(document, descriptor, place, now);
  return admitCoverings(context, coverings, now, lock);
}

export async function admitCoverings(
  context: BudgetScope,
  coverings: Covering[],
  now: Date,
  lock: boolean,
): Promise<Admission> {
  if (!coverings.length) return { coverings, standings: [] };
  if (lock) await lockWindows(context, coverings);
  return {
    coverings,
    standings: await standingsOf(
      context,
      context.environmentId,
      coverings,
      now,
    ),
  };
}

const strength = { deny: 0, none: 1, allow: 2 } as const;

/**
 * The decision with Cloud's numeric budgets in it, as the engine weighs a
 * ledger's: the strictest of the rules, gates and every budget that holds.
 * A budget only ever holds; it never allows what the rules don't.
 */
export function withLimits(
  verdict: RunVerdict,
  standings: LimitState[],
): RunVerdict {
  if (!standings.length) return verdict;
  let winner: RunVerdict = { ...verdict, limits: standings };
  for (const standing of standings) {
    if (standing.state === "ok") continue;
    if (strength[standing.effect] < strength[winner.outcome])
      winner = {
        ...winner,
        outcome: standing.effect,
        matchedRuleId: standing.id,
        reason: "budget",
        explanation: explainLimit(standing),
        requirements: undefined,
      };
  }
  return winner;
}

/**
 * Sets aside each covering budget's share for a call that goes ahead: its
 * amount for admission, an open reading for a measured budget. Once per
 * action and budget; called right after the permit is issued, holding the
 * windows `admit` locked.
 */
export async function reserve(
  context: RuntimeContext,
  actionId: string,
  permit: { id: string; expiresAt: Date },
  admission: Admission | undefined,
) {
  const unknownAfter = new Date(
    permit.expiresAt.getTime() + UNKNOWN_AFTER_MINUTES * 60_000,
  );
  await writeReservations(
    context,
    { actionId, permitId: permit.id, unknownAfter },
    admission,
  );
}

type ReservationOwner =
  | { actionId: string; permitId: string; unknownAfter: Date }
  | { leaseId: string; unknownAfter: Date; createdAt: Date };

export async function writeReservations(
  { manager, workspaceId, environmentId }: BudgetScope,
  owner: ReservationOwner,
  admission: Admission | undefined,
) {
  for (const { budget, windowId, amount } of admission?.coverings ?? []) {
    if (!windowId) continue;
    const measured = budget.source === "measured";
    // A call whose amount can't be known adds nothing to set aside.
    if (!measured && amount === null) continue;
    const path = budget.measure.kind === "sum" ? budget.measure.path : "tokens";
    await manager.query(
      `INSERT INTO nodrail.budget_reservations
         (workspace_id, environment_id, action_request_id, permit_id,
          window_id, budget_key, source, unit, amount, measured_path,
          unknown_after, lease_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, clock_timestamp()))`,
      [
        workspaceId,
        environmentId,
        "actionId" in owner ? owner.actionId : null,
        "permitId" in owner ? owner.permitId : null,
        windowId,
        budget.id,
        budget.source,
        budget.unit,
        measured ? null : amount,
        measured ? path : null,
        owner.unknownAfter,
        "leaseId" in owner ? owner.leaseId : null,
        "createdAt" in owner ? owner.createdAt : null,
      ],
    );
  }
}
