import { environmentQuery } from "@/contracts/v1/public-api";
import { getWorkspaceSettings } from "@/server/modules/workspaces";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  async (context) => ({
    ...(await getWorkspaceSettings(context)),
    role: context.role,
    capabilities: [...context.capabilities],
    is_owner: context.isOwner,
  }),
);
