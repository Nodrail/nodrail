import { environmentQuery } from "@/contracts/v1/public-api";
import { getActivityEvent } from "@/server/modules/activity";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ id: string }>(
  { scope: "read", access: "read", query: environmentQuery },
  (context, call) =>
    getActivityEvent(context, call.environment, call.params.id),
);
