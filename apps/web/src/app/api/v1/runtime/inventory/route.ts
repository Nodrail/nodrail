import { recordHostObservation } from "@/server/modules/inventory/host";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("heartbeat:write", (context, call) =>
  recordHostObservation(context, call.body),
);
