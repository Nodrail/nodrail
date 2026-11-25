import { environmentQuery } from "@/contracts/v1/public-api";
import { budgetStatus } from "@/server/modules/budgets/read";
import { publicRoute } from "@/server/public-api/route";

/**
 * The live version's numeric budgets, their open windows and the
 * reservations whose outcome isn't known. Operational limits, not the bill.
 */
export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => budgetStatus(context, call.environment),
);
