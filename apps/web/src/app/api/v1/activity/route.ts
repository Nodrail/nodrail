import { activityApiQuery } from "@/contracts/v1/public-api";
import { listActivity } from "@/server/modules/activity";
import { publicRoute } from "@/server/public-api/route";
import { page } from "@/server/public-api/wire";

export const GET = publicRoute(
  { scope: "read", access: "read", query: activityApiQuery },
  async (context, call) => {
    const { limit, ...filters } = call.query;
    const found = await listActivity(context, call.environment, filters, limit);
    return page(found.items, found.nextCursor);
  },
);
