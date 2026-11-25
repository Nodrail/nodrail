import { environmentQuery } from "@/contracts/v1/public-api";
import { reconcileReservation } from "@/server/modules/budgets/reconcile";
import { publicRoute } from "@/server/public-api/route";

/**
 * A person's word on a reservation whose outcome isn't known: consumed or
 * released, with a note. Admins and policy managers, with `rules:write`.
 */
export const POST = publicRoute<{ id: string }>(
  { scope: "rules:write", access: "write", query: environmentQuery },
  (context, call) =>
    reconcileReservation(context, call.environment, call.params.id, call.body),
);
