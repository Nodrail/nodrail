import { notFound } from "next/navigation";
import { WorkspaceFrame } from "@/features/shell/components/workspace-frame";
import { loadWorkspaceView } from "@/features/shell/load-view";

export default async function WorkspaceLayout({
  children,
  params,
}: LayoutProps<"/app/[workspace]/[environment]">) {
  const { workspace, environment } = await params;
  const view = await loadWorkspaceView(workspace);
  if (!view.environments.some((item) => item.slug === environment)) notFound();
  return (
    <WorkspaceFrame view={view} environment={environment}>
      {children}
    </WorkspaceFrame>
  );
}
