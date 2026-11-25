import { workspaceDownload } from "@/server/http/download";
import { exportWorkspace } from "@/server/modules/workspaces/export";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspace: string }> },
) {
  const { workspace } = await params;
  return workspaceDownload(workspace, {
    type: "application/json",
    name: (slug) => `nodrail-${slug}.json`,
    body: async (context) =>
      JSON.stringify(await exportWorkspace(context), null, 2),
  });
}
