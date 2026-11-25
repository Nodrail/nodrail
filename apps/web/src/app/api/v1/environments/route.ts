import { environmentQuery } from "@/contracts/v1/public-api";
import { page } from "@/server/public-api/wire";
import { findEnvironment, listEnvironments } from "@/server/modules/workspaces";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context, call) => {
    if (call.query.environment)
      return page([await findEnvironment(context, call.environment)]);
    return page(await listEnvironments(context));
  },
);
