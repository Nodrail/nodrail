import { metThreshold } from "@/server/modules/billing";
import { recordStep } from "@/server/modules/runs/steps";
import { deliverSoon } from "@/server/notifications/deliver-soon";
import { runtimeRoute } from "@/server/runtime-api";

// A step is part of the run history intents are decided with, so it takes the
// same scope as submitting one: every existing credential can record steps.
export const POST = runtimeRoute(
  ["decisions:write", "actions:submit"],
  async (context, call) => {
    const recorded = await recordStep(context, call.body);
    // Steps are many, so delivery runs only for the one that met a threshold.
    if (metThreshold(context)) deliverSoon();
    return recorded;
  },
);
