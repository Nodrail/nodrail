import type { Metadata } from "next";
import { WorkspaceDataCard } from "@/features/settings/components/data-controls";
import { openManagePage } from "@/features/shell/components/manage-section";

export const metadata: Metadata = { title: "Workspace data" };

export default async function WorkspaceDataPage({
  params,
}: PageProps<"/app/[workspace]/settings/data">) {
  const { workspace } = await params;
  const { view, header } = await openManagePage(workspace, "settings", "data");
  return (
    <>
      {header}
      <div className="grid gap-4">
        <WorkspaceDataCard
          workspace={workspace}
          workspaceName={view.name}
          canExport={view.capabilities.includes("workspace:settings")}
          isOwner={view.isOwner}
        />
      </div>
    </>
  );
}
