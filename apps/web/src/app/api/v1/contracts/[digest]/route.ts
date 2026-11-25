import { contractQuery } from "@/contracts/v1/public-api";
import { getContract } from "@/server/modules/contracts/catalog";
import { publicRoute } from "@/server/public-api/route";

/**
 * A contract revision and its projections, or a projection, by digest. The
 * full schema only for people who may write policies.
 */
export const GET = publicRoute<{ digest: string }, typeof contractQuery>(
  { scope: "read", access: "read", query: contractQuery },
  (context, call) =>
    getContract(context, call.params.digest, call.query.surface),
);
