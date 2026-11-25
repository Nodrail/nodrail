import "server-only";
import { AppError, type RuntimeContext } from "@/server/db/context";

// Settlement in Cloud: what an installation's report does to
// the reservations its permit set aside. `success` consumes, `failure`
// releases, `unknown` keeps counting until a person reconciles it, and a missing
// report keeps counting for permits and started host leases. The first report
// stands. Receipts, details and anything else an agent says never reach
// here: only the outcome and the measured result amounts.

type ReservationKey = { actionId: string } | { leaseId: string };

const columnOf = (key: ReservationKey) =>
  "actionId" in key ? "action_request_id" : "lease_id";
const idOf = (key: ReservationKey) =>
  "actionId" in key ? key.actionId : key.leaseId;

type Outcome = "success" | "failure" | "unknown";

/** The amount measured for each result path a reservation reads. */
export type Reading = ReadonlyMap<string, number>;

/**
 * The measured amounts as a budget may use them: each must be a path that a
 * measured budget this action reserved reads. Anything else is refused
 * whole (`INVALID_INPUT`), so a reading never lands half-counted.
 */
export async function readingFor(
  context: RuntimeContext,
  key: ReservationKey,
  measured: readonly { path: string; value: number }[],
  options: { tokens?: number; filter?: boolean } = {},
): Promise<Reading> {
  const values =
    options.tokens === undefined
      ? measured
      : [...measured, { path: "tokens", value: options.tokens }];
  if (!values.length) return new Map();
  const rows: { measured_path: string }[] = await context.manager.query(
    `SELECT DISTINCT measured_path FROM nodrail.budget_reservations
     WHERE workspace_id = $1 AND ${columnOf(key)} = $2 AND measured_path IS NOT NULL`,
    [context.workspaceId, idOf(key)],
  );
  const read = new Set(rows.map((row) => row.measured_path));
  if (!options.filter && values.some(({ path }) => !read.has(path)))
    throw new AppError("INVALID_INPUT");
  return new Map(
    values
      .filter(({ path }) => read.has(path))
      .map(({ path, value }) => [path, value]),
  );
}

const stateFor: Record<Outcome, "consumed" | "released" | "unknown"> = {
  success: "consumed",
  failure: "released",
  unknown: "unknown",
};

/**
 * Settles every reservation of the action still open. A measured budget's
 * call that succeeded takes its reading, or none: no reading is unknown,
 * and it holds, never zero.
 */
export async function settle(
  context: RuntimeContext,
  key: ReservationKey,
  outcome: Outcome,
  reading: Reading,
) {
  const state = stateFor[outcome];
  await context.manager.query(
    `UPDATE nodrail.budget_reservations
     SET state = $3, settled_by = 'runtime', settled_at = clock_timestamp(),
         measured = CASE WHEN $3 = 'consumed' AND source = 'measured'
                         THEN ($4::jsonb ->> measured_path)::bigint END
     WHERE workspace_id = $1 AND ${columnOf(key)} = $2 AND state = 'reserved'
       AND (lease_id IS NULL OR started_at IS NOT NULL)`,
    [
      context.workspaceId,
      idOf(key),
      state,
      JSON.stringify(Object.fromEntries(reading)),
    ],
  );
}
