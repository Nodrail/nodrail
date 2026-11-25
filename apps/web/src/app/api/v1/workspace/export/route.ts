import { environmentQuery } from "@/contracts/v1/public-api";
import { exportWorkspace } from "@/server/modules/workspaces/export";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "workspace:settings", access: "read", query: environmentQuery },
  exportWorkspace,
);
