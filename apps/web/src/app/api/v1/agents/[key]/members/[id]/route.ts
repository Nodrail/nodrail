import { environmentQuery } from "@/contracts/v1/public-api";
import { unassignAgent } from "@/server/modules/team/members";
import { publicRoute } from "@/server/public-api/route";

export const DELETE = publicRoute<{ key: string; id: string }>(
  { scope: "members:manage", access: "write", query: environmentQuery },
  (context, call) => unassignAgent(context, call.params.key, call.params.id),
);
