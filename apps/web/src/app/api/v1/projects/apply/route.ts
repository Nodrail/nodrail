import { projectApplyBody } from "@/contracts/v1/project-apply";
import {
  environmentQuery,
  MAX_POLICY_JSON_BYTES,
} from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { applyProject } from "@/server/modules/policies/project-apply";
import { tokenRoute } from "@/server/public-api/route";

export const POST = tokenRoute(
  {
    scope: "rules:write",
    access: "write",
    query: environmentQuery,
    maxBodyBytes: MAX_POLICY_JSON_BYTES + 8_000_000,
  },
  (context, call) =>
    applyProject(
      context,
      call.environment,
      parseInput(projectApplyBody, call.body),
    ),
);
