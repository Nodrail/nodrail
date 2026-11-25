import type { Metadata } from "next";
import { NotificationsForm } from "@/features/settings/components/settings-forms";
import { openManagePage } from "@/features/shell/components/manage-section";
import { readForPage } from "@/features/shell/load-view";
import { deploymentMode } from "@/server/deployment";
import { getNotificationPreferences } from "@/server/modules/workspaces";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  params,
}: PageProps<"/app/[workspace]/account/notifications">) {
  const { workspace } = await params;
  const { view, header } = await openManagePage(
    workspace,
    "account",
    "notifications",
  );
  const preferences = await readForPage(workspace, getNotificationPreferences);
  return (
    <>
      {header}
      <div className="grid gap-4">
        <NotificationsForm
          workspace={workspace}
          preferences={preferences}
          capabilities={view.capabilities}
          showBilling={deploymentMode() === "cloud"}
        />
      </div>
    </>
  );
}
