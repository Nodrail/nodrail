import { requestPermit } from "@/server/modules/runtime";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute<{ id: string }>(
  "permits:request",
  (context, call) => requestPermit(context, call.params.id, call.body),
);
