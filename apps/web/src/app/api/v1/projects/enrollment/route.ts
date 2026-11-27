import { enrollmentBody } from "@/contracts/v1/project-apply";
import { environmentQuery } from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { enrollmentPreflight } from "@/server/modules/policies/enrollment-preflight";
import { tokenRoute } from "@/server/public-api/route";

export const POST = tokenRoute(
  {
    scope: "read",
    access: "write",
    query: environmentQuery,
    maxBodyBytes: 4096,
  },
  (context, call) => {
    const { project_id: projectId, machine } = parseInput(
      enrollmentBody,
      call.body,
    );
    return enrollmentPreflight(context, call.environment, projectId, machine);
  },
);
