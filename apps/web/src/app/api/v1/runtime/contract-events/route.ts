import { submitContractEvent } from "@/server/modules/contracts/submit";
import { runtimeRoute } from "@/server/runtime-api";

// A brief, a connection's input or its result, validated by the server
// against the published contract. Part of the run history intents are
// decided with, so it takes the same scope as submitting one.
export const POST = runtimeRoute("actions:submit", (context, call) =>
  submitContractEvent(context, call.body),
);
