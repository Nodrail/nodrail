import type { Metadata } from "next";
import { Card, FactList } from "@/components/app/card";
import { WorkspaceForm } from "@/features/settings/components/settings-forms";
import { openManagePage } from "@/features/shell/components/manage-section";

export const metadata: Metadata = { title: "Settings" };

export default async function GeneralSettingsPage({
  params,
}: PageProps<"/app/[workspace]/settings/general">) {
  const { workspace } = await params;
  const { view, header } = await openManagePage(
    workspace,
    "settings",
    "general",
  );
  const environment = view.environments.find(
    (item) => item.id === view.defaultEnvironmentId,
  );
  return (
    <>
      {header}
      <div className="grid gap-4">
        {view.capabilities.includes("workspace:settings") ? (
          <WorkspaceForm
            workspace={workspace}
            name={view.name}
            environments={view.environments}
            defaultEnvironment={environment?.slug ?? ""}
          />
        ) : (
          <Card title="Workspace">
            <FactList
              facts={[
                { label: "Workspace name", value: view.name },
                {
                  label: "Default environment",
                  value: environment?.name ?? "—",
                },
              ]}
            />
          </Card>
        )}
      </div>
    </>
  );
}
