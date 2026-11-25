import { environmentQuery } from "@/contracts/v1/public-api";
import { listInventory } from "@/server/modules/inventory";
import { publicRoute } from "@/server/public-api/route";

/** The environment's inventory: everyone's for admins and policy managers, else your own. */
export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => listInventory(context, call.environment),
);
