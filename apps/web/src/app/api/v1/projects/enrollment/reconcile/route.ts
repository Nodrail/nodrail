import { enrollmentReconcileBody } from "@/contracts/v1/project-apply";
import { environmentQuery } from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { reconcileEnrollment } from "@/server/modules/agents/reconcile-enrollment";
import { tokenRoute } from "@/server/public-api/route";

export const POST = tokenRoute(
  { scope: "rules:write", access: "write", query: environmentQuery },
  (context, call) =>
    reconcileEnrollment(
      context,
      call.environment,
      parseInput(enrollmentReconcileBody, call.body),
    ),
);
