import { contractEventsApiQuery } from "@/contracts/v1/public-api";
import { listContractEvents } from "@/server/modules/contracts/read";
import { publicRoute } from "@/server/public-api/route";

/**
 * Declared-contract events, newest first, with the reasons a page may be
 * incomplete. Projected values only: what a projection withholds is listed
 * by path, never sent.
 */
export const GET = publicRoute(
  { scope: "read", access: "read", query: contractEventsApiQuery },
  async (context, call) => {
    const { environment: _, ...query } = call.query;
    return listContractEvents(context, call.environment, query);
  },
);
