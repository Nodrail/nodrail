import { liveRulesQuery } from "@/contracts/v1/public-api";
import { readLiveVersion } from "@/server/modules/policies/managed";
import { publicRoute } from "@/server/public-api/route";

/**
 * The live version's revision, who published it and when, and the
 * repository project and lock it came from, if any: what `nodrail
 * plan` compares with its lock. Works for every version, including those
 * the YAML endpoint can't render.
 */
export const GET = publicRoute(
  { scope: "read", access: "read", query: liveRulesQuery },
  (context, call) =>
    readLiveVersion(context, call.environment, call.query.workspace_revision),
);
