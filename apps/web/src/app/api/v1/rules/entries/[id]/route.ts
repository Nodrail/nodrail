import { environmentQuery } from "@/contracts/v1/public-api";
import { getRule } from "@/server/modules/policies";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ id: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => getRule(context, call.environment, call.params.id),
);
