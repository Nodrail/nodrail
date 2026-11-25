import { environmentQuery } from "@/contracts/v1/public-api";
import { policySuggestions } from "@/server/modules/policies/suggestions";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => policySuggestions(context, call.environment),
);
