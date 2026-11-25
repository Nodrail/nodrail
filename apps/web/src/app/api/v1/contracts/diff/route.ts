import { contractDiffQuery } from "@/contracts/v1/public-api";
import { diffContracts } from "@/server/modules/contracts/catalog";
import { publicRoute } from "@/server/public-api/route";

/**
 * What changes between two published workspace revisions of a project:
 * bindings, disclosed fields and breaking changes.
 */
export const GET = publicRoute(
  { scope: "read", access: "read", query: contractDiffQuery },
  async (context, call) => {
    const { environment: _, ...query } = call.query;
    return { changes: await diffContracts(context, call.environment, query) };
  },
);
