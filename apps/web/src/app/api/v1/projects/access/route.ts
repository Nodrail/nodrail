import { projectAccess } from "@/contracts/v1/project-apply";
import { environmentQuery } from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { changeProjectAccess } from "@/server/modules/agents/project-access";
import { tokenRoute } from "@/server/public-api/route";

export const POST = tokenRoute(
  {
    scope: "agents:manage",
    access: "write",
    query: environmentQuery,
    maxBodyBytes: 4096,
  },
  (context, call) =>
    changeProjectAccess(context, parseInput(projectAccess, call.body)),
);
