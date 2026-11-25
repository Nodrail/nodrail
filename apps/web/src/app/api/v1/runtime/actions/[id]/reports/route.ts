import { reportOutcome } from "@/server/modules/runtime";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute<{ id: string }>(
  "reports:write-own",
  (context, call) => reportOutcome(context, call.params.id, call.body),
);
