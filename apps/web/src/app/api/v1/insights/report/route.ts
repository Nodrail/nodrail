import { insightsQuery } from "@/contracts/v1/public-api";
import { getReport } from "@/server/modules/reports";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: insightsQuery },
  (context, call) => getReport(context, call.environment, call.query.days),
);
