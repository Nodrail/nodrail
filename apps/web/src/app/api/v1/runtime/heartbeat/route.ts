import { recordHeartbeat } from "@/server/modules/runtime";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("heartbeat:write", (context, call) =>
  recordHeartbeat(context, call.body),
);
