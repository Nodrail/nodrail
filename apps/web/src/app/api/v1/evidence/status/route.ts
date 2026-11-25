import { evidenceStatusQuery } from "@/contracts/v1/evidence";
import { evidenceStatus } from "@/server/modules/evidence/status";
import { publicRoute } from "@/server/public-api/route";

/**
 * Whether verified evidence meets one requirement of a published revision,
 * for a local gate. A `read` token; `access: "write"` only keeps the
 * application role, since the evaluator reads values the read role can't.
 * It changes nothing and returns none of them.
 */
export const GET = publicRoute(
  { scope: "read", access: "write", query: evidenceStatusQuery },
  (context, call) => evidenceStatus(context, call.query),
);
