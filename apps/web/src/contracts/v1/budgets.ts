import {
  BUDGET_LABELS,
  type BudgetLabel,
  type LimitState,
  type NumericBudget,
} from "@nodrail/policy-engine";
import { z } from "zod";

// Numeric budgets in Cloud (C03, Wave 3): the shared online authority.
// A call that goes ahead reserves its amount when its permit is issued;
// its report settles it. Operational limits, never the Nodrail bill.

/**
 * What became of one call's reservation. `reserved`: the permit was issued
 * and nothing was reported yet. `consumed`: it ran. `released`: it failed,
 * so it never counts. `unknown`: its outcome wasn't known; it keeps
 * counting until an admin or policy manager reconciles it.
 */
export const reservationStates = [
  "reserved",
  "consumed",
  "released",
  "unknown",
] as const;
export type ReservationState = (typeof reservationStates)[number];

/** Who settled a reservation: the installation's report, or a person. */
export const settledBy = ["runtime", "person"] as const;
export type SettledBy = (typeof settledBy)[number];

/**
 * A reservation with no report is shown as unknown this long after its
 * permit expired. It changes nothing it counts: there is no expiry.
 */
export const UNKNOWN_AFTER_MINUTES = 10;

/** The words a budget's label shows, derived from its source. */
export const budgetLabelText = (label: BudgetLabel) => BUDGET_LABELS[label];

export type BudgetLimitDto = {
  id: string;
  name: string;
  label: BudgetLabel;
  labelText: string;
  source: NumericBudget["source"];
  measure: NumericBudget["measure"];
  unit: string;
  limit: number;
  per: NumericBudget["per"];
  timezone: string | null;
  across: NumericBudget["across"];
  effect: NumericBudget["effect"];
  /** The agent it counts, or null for every agent. */
  agent: string | null;
};

/**
 * Where a budget stood for one call, as the decision saw it: the engine's
 * numbers (`unread`: measured calls with no reading, which hold), with only
 * the states Cloud decides in.
 */
export type BudgetStandingDto = Omit<LimitState, "effect" | "state"> & {
  state: "ok" | "over" | "unknown" | "no_run";
};

/** A budget's standing as a hold shows it; only the states Cloud decides in. */
export function standingDto(standing: LimitState): BudgetStandingDto {
  const { effect: _effect, state, ...rest } = standing;
  return {
    ...rest,
    state:
      state === "ok" || state === "over" || state === "no_run"
        ? state
        : "unknown",
  };
}

/** One counting window of a budget and what is in it. */
export type BudgetWindowDto = {
  id: string;
  budgetId: string;
  per: NumericBudget["per"];
  across: NumericBudget["across"];
  /** The run it counts, by key, for a run or step window. */
  runKey: string | null;
  stepKey: string | null;
  /** The local date of a day window. */
  day: string | null;
  timezone: string | null;
  startsAt: string | null;
  endsAt: string | null;
  unit: string;
  consumed: number;
  reserved: number;
  unknown: number;
  measured: number;
  unread: number;
};

export type BudgetReservationDto = {
  id: string;
  budgetId: string;
  windowId: string;
  /** Null until the host records the decision associated with the lease. */
  actionId: string | null;
  tool: string | null;
  operation: string | null;
  source: NumericBudget["source"];
  unit: string;
  /** Reserved before the call (admission); null for a measured budget. */
  amount: number | null;
  /** The result path a measured budget reads, or `tokens`. */
  measuredPath: string | null;
  measured: number | null;
  /** As stored. */
  state: ReservationState;
  /** On expiry, unreported host leases show as released and permit reservations as unknown. */
  shownAs: ReservationState;
  settledBy: SettledBy | null;
  settledAt: string | null;
  note: string | null;
  createdAt: string;
};

export type BudgetStatusDto = {
  limits: BudgetLimitDto[];
  windows: BudgetWindowDto[];
  /** Reservations shown as unknown, oldest first: what reconcile is for. */
  unknown: BudgetReservationDto[];
};

export const reservationsQuery = z
  .object({
    environment: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .optional(),
    state: z.enum(reservationStates).optional(),
    action: z.uuid().optional(),
  })
  .strict();

/**
 * A person's word on a reservation whose outcome isn't known. A measured
 * budget's call that ran names what it measured; nothing else does.
 */
export const reconcileInput = z
  .object({
    state: z.enum(["consumed", "released"]),
    note: z.string().trim().min(1).max(500),
    measured: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export type ReconcileInput = z.infer<typeof reconcileInput>;
