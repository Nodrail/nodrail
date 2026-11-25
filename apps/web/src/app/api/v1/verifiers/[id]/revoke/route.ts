import { environmentQuery } from "@/contracts/v1/public-api";
import { revokeVerifier } from "@/server/modules/evidence/verifiers";
import { publicRoute } from "@/server/public-api/route";

/** Revokes a verifier: none of its evidence counts any more. */
export const POST = publicRoute<{ id: string }>(
  { scope: "rules:write", access: "write", query: environmentQuery },
  (context, call) => revokeVerifier(context, call.params.id),
);
