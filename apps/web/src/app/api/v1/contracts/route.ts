import { contractsQuery } from "@/contracts/v1/public-api";
import { listContractBindings } from "@/server/modules/contracts/catalog";
import { publicRoute } from "@/server/public-api/route";

/**
 * A project's declared-contract bindings in its intended workspace revision
 * (or the one named): what each attaches, and whether Cloud holds the full
 * schema or only what is reported.
 */
export const GET = publicRoute(
  { scope: "read", access: "read", query: contractsQuery },
  async (context, call) => {
    const { environment: _, ...query } = call.query;
    return {
      bindings: await listContractBindings(context, call.environment, query),
    };
  },
);
