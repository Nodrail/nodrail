import { workspaceDownload } from "@/server/http/download";
import { exportPolicyFile } from "@/server/modules/policies/rule-files";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspace: string; environment: string }> },
) {
  const { workspace, environment } = await params;
  return workspaceDownload(workspace, {
    type: "application/yaml; charset=utf-8",
    name: (slug) => `nodrail-${slug}-${environment}.yaml`,
    body: (context) => exportPolicyFile(context, environment),
  });
}
