import { noInput } from "@/contracts/v1/management";
import { createWorkspaceInput } from "@/contracts/v1/workspaces";
import { createWorkspace, listMyWorkspaces } from "@/server/modules/workspaces";
import { sessionRoute } from "@/server/public-api/session-route";
import { page } from "@/server/public-api/wire";

export const GET = sessionRoute(noInput, async (principal) =>
  page(await listMyWorkspaces(principal)),
);
export const POST = sessionRoute(createWorkspaceInput, createWorkspace);
