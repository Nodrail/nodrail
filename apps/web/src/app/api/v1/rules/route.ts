import { environmentQuery } from "@/contracts/v1/public-api";
import { readPolicyFile } from "@/server/modules/policies/rule-files";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context, call) => ({
    environment: call.environment,
    yaml: await readPolicyFile(context, call.environment),
  }),
);
