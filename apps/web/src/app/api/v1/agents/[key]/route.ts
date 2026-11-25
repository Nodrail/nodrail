import { environmentQuery } from "@/contracts/v1/public-api";
import { getAgent } from "@/server/modules/agents";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ key: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => getAgent(context, call.params.key, call.environment),
);
