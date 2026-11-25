import { recordHostDecisions } from "@/server/modules/runtime/host-decisions";
import { runtimeRoute } from "@/server/runtime-api";

/**
 * Calls the hook decided on its host (`decisions:write`), recorded in
 * their runs and Activity as Cloud's own are. Cloud never decides them
 * again: no permit or budget reservation comes from here.
 */
export const POST = runtimeRoute("decisions:write", (context, call) =>
  recordHostDecisions(context, call.body),
);
