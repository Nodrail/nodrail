import { environmentQuery } from "@/contracts/v1/public-api";
import { getCheckIn } from "@/server/modules/agents/check-in";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ key: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => getCheckIn(context, call.environment, call.params.key),
);
