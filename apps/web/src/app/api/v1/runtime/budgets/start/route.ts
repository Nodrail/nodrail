import { startSharedBudgets } from "@/server/modules/budgets/host-start";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("budgets:reserve", (context, call) =>
  startSharedBudgets(context, call.body),
);
