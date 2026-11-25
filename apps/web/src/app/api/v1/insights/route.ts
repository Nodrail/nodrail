import { insightsQuery } from "@/contracts/v1/public-api";
import { getDecisionMetrics, getRuleMetrics } from "@/server/modules/insights";
import { publicRoute } from "@/server/public-api/route";

/** The numbers behind the Insights page, for one window. */
export const GET = publicRoute(
  { scope: "read", access: "read", query: insightsQuery },
  async (context, call) => {
    const { days } = call.query;
    return {
      days,
      decisions: await getDecisionMetrics(context, call.environment, days),
      rules: await getRuleMetrics(context, call.environment, days),
    };
  },
);
