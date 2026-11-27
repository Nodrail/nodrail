import { disconnectMachine } from "@/server/modules/agents/disconnect";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute(
  "policy:read",
  disconnectMachine,
  "disconnect",
);
