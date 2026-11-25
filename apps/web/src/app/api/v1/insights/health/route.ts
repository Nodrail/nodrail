import { environmentQuery } from "@/contracts/v1/public-api";
import { getHealth } from "@/server/modules/health";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => getHealth(context, call.environment),
);
