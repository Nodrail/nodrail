import { environmentQuery } from "@/contracts/v1/public-api";
import { page } from "@/server/public-api/wire";
import { listAgentOptions } from "@/server/modules/agents";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context, call) =>
    page(await listAgentOptions(context, call.environment)),
);
