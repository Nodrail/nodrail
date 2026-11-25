import { environmentQuery } from "@/contracts/v1/public-api";
import { getRun } from "@/server/modules/runs";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ id: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) => getRun(context, call.environment, call.params.id),
);
