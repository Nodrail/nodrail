import { environmentQuery } from "@/contracts/v1/public-api";
import { workspaceSettingsBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "@/server/modules/workspaces";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  getWorkspaceSettings,
);

export const PATCH = publicRoute(
  { scope: "workspace:settings", access: "write", query: environmentQuery },
  async (context, call) => {
    const { name, default_environment } = parseInput(
      workspaceSettingsBody,
      call.body,
    );
    await updateWorkspaceSettings(context, {
      name,
      defaultEnvironment: default_environment,
    });
    return getWorkspaceSettings(context);
  },
);
