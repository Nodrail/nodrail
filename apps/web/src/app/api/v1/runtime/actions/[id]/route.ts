import { getActionStatus } from "@/server/modules/runtime";
import { runtimeRoute } from "@/server/runtime-api";

export const GET = runtimeRoute<{ id: string }>(
  "actions:read-own",
  (context, call) => getActionStatus(context, call.params.id),
);
