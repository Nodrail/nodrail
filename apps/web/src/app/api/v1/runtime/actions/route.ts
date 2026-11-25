import { deliverSoon } from "@/server/notifications/deliver-soon";
import { findActionByKey, submitAction } from "@/server/modules/runtime";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("actions:submit", async (context, call) => {
  const status = await submitAction(
    context,
    call.request.headers.get("idempotency-key"),
    call.body,
  );
  deliverSoon();
  return status;
});

export const GET = runtimeRoute("actions:read-own", (context, call) =>
  findActionByKey(
    context,
    call.request.nextUrl.searchParams.get("idempotency_key"),
  ),
);
