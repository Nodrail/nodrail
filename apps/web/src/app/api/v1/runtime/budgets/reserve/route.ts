import { reserveSharedBudgets } from "@/server/modules/budgets/host";
import { runtimeRoute } from "@/server/runtime-api";

export const POST = runtimeRoute("budgets:reserve", (context, call) =>
  reserveSharedBudgets(context, call.body),
);
