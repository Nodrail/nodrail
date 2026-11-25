import "server-only";
import {
  reconcileInput,
  type BudgetReservationDto,
} from "@/contracts/v1/budgets";
import {
  AppError,
  parseInput,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";
import { findEnvironment } from "@/server/modules/workspaces";
import { lockedReservation } from "./read";

// A person's word on a reservation whose outcome isn't known: an
// admin or policy manager says the call ran (consumed) or didn't
// (released), with a note, and it is audited. Cloud only; a local ledger's
// unknowns are reconciled on the machine with the CLI, never from here.

/**
 * Settles one reservation shown as unknown: reported unknown, or never
 * reported once its permit's time plus ten minutes passed. Anything already
 * settled is refused (`DECISION_CONFLICT`): a known outcome isn't
 * re-decided, and a person's word isn't given twice.
 */
export async function reconcileReservation(
  context: WorkspaceContext,
  environmentSlug: string,
  reservationId: string,
  rawInput: unknown,
): Promise<BudgetReservationDto> {
  requireCapability(context, "policies:write");
  const input = parseInput(reconcileInput, rawInput);
  const environment = await findEnvironment(context, environmentSlug);
  const found = await lockedReservation(context, environment.id, reservationId);
  if (!found) throw new AppError("NOT_FOUND");
  if (found.shownAs !== "unknown") throw new AppError("DECISION_CONFLICT");
  // Only a measured call that ran has a reading to give, and it must.
  const reads = found.source === "measured" && input.state === "consumed";
  if (reads !== (input.measured !== undefined))
    throw new AppError("INVALID_INPUT");

  await context.manager.query(
    `UPDATE nodrail.budget_reservations
     SET state = $3, settled_by = 'person', settled_at = clock_timestamp(),
         reconciled_by = $4, note = $5, measured = $6
     WHERE workspace_id = $1 AND id = $2`,
    [
      context.workspaceId,
      found.id,
      input.state,
      context.principal.userId,
      input.note,
      reads ? input.measured : null,
    ],
  );
  await recordAudit(context, {
    eventType: "budget.reconciled",
    decisionCode: "budget_reconciled",
    actionRequestId: found.actionId ?? undefined,
    environmentId: environment.id,
    payload: {
      subject: `Budget ${found.budgetId}`,
      reservation: found.id,
      detail: `${found.shownAs} → ${input.state}`,
      note: input.note,
      ...(reads ? { measured: input.measured } : {}),
    },
  });
  const settled = await lockedReservation(context, environment.id, found.id);
  if (!settled) throw new AppError("BUSY");
  return settled;
}
