import { environmentQuery } from "@/contracts/v1/public-api";
import { registerProjection } from "@/server/modules/contracts/registry";
import { tokenRoute } from "@/server/public-api/route";

/**
 * Registers a reporting projection before the first report that names it
 * (`inventory:write`, which reads nothing back). Its digest is recomputed;
 * registering the same content again is a no-op.
 */
export const POST = tokenRoute(
  { scope: "inventory:write", access: "write", query: environmentQuery },
  (context, call) => registerProjection(context, call.body),
);
