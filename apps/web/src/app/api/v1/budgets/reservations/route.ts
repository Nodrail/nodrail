import { reservationsQuery } from "@/contracts/v1/budgets";
import { listReservations } from "@/server/modules/budgets/read";
import { publicRoute } from "@/server/public-api/route";
import { page } from "@/server/public-api/wire";

/** Reservations, newest first; `state=unknown` lists what reconcile is for. */
export const GET = publicRoute(
  { scope: "read", access: "read", query: reservationsQuery },
  async (context, call) => {
    const { environment: _environment, ...filters } = call.query;
    return page(await listReservations(context, call.environment, filters));
  },
);
