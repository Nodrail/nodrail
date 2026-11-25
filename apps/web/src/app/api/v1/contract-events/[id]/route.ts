import { environmentQuery } from "@/contracts/v1/public-api";
import { getContractEvent } from "@/server/modules/contracts/read";
import { publicRoute } from "@/server/public-api/route";

/** One declared-contract event, as the inspector shows it. */
export const GET = publicRoute<{ id: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) =>
    getContractEvent(context, call.environment, call.params.id),
);
