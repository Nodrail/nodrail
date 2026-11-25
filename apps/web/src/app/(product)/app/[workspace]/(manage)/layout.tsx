import { notFound } from "next/navigation";
import { WorkspaceFrame } from "@/features/shell/components/workspace-frame";
import {
  defaultEnvironment,
  loadWorkspaceView,
} from "@/features/shell/load-view";

/**
 * Workspace settings and your account are in no environment: the sidebar's
 * links lead to the workspace's default one.
 */
export default async function ManageFrameLayout({
  children,
  params,
}: LayoutProps<"/app/[workspace]">) {
  const view = await loadWorkspaceView((await params).workspace);
  const environment = defaultEnvironment(view);
  if (!environment) notFound();
  return (
    <WorkspaceFrame view={view} environment={environment.slug}>
      {children}
    </WorkspaceFrame>
  );
}
