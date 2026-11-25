import { environmentQuery } from "@/contracts/v1/public-api";
import { archiveWorkspaceBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { archiveWorkspace } from "@/server/modules/workspaces";
import { publicRoute } from "@/server/public-api/route";

export const POST = publicRoute(
  { scope: "read", access: "write", query: environmentQuery, auth: "session" },
  (context, call) =>
    archiveWorkspace(
      context,
      parseInput(archiveWorkspaceBody, call.body).confirmation,
    ),
);
