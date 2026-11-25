import { settleSharedBudgets } from "@/server/modules/budgets/host-settle";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("reports:write-own", (context, call) =>
  settleSharedBudgets(context, call.body),
);
