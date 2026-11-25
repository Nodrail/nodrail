import { environmentQuery } from "@/contracts/v1/public-api";
import { listRules } from "@/server/modules/policies";
import { ruleLastMatched } from "@/server/modules/policies/usage";
import { activeRunPolicy } from "@/server/modules/runs/policy";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context, call) => ({
    ...(await listRules(context, call.environment)),
    policy: await activeRunPolicy(context, call.environment),
    lastMatched: await ruleLastMatched(context, call.environment),
  }),
);
