import { workspaceJson } from "@/server/http/workspace-json";
import { getCheckIn } from "@/server/modules/agents/check-in";

/** Whether a newly connected agent has checked in, for its setup to follow. */
export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspace: string; environment: string; agent: string }>;
  },
) {
  const { workspace, environment, agent } = await params;
  return workspaceJson(workspace, (context) =>
    getCheckIn(context, environment, agent),
  );
}
