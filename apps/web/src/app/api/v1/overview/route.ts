import { environmentQuery } from "@/contracts/v1/public-api";
import {
  getOverviewState,
  getRecentDecisions,
  getToday,
} from "@/server/modules/overview";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context, { environment }) => ({
    state: await getOverviewState(context, environment),
    today: await getToday(context, environment),
    recentDecisions: await getRecentDecisions(context, environment),
  }),
);
