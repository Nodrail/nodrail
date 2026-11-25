import { runsApiQuery } from "@/contracts/v1/public-api";
import { listRuns } from "@/server/modules/runs";
import { publicRoute } from "@/server/public-api/route";
import { page } from "@/server/public-api/wire";

export const GET = publicRoute(
  { scope: "read", access: "read", query: runsApiQuery },
  async (context, call) => {
    const { limit, ...filters } = call.query;
    const found = await listRuns(context, call.environment, filters, limit);
    return page(found.runs, found.nextCursor);
  },
);
