import { environmentQuery } from "@/contracts/v1/public-api";
import { budgetUsage } from "@/server/modules/policies/usage";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => budgetUsage(context, call.environment),
);
