import "server-only";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { deploymentMode } from "@/server/deployment";
import { loadWorkspaceView } from "@/features/shell/load-view";
import {
  accountPages,
  canOpen,
  settingsPages,
  type AccountPage,
  type ManagePage,
  type SettingsPage,
} from "../navigation";
import { ManageLayout, type ManageGroup } from "./manage-nav";
import { PageHeader } from "./page-header";

type PageOf = { settings: SettingsPage; account: AccountPage };

/**
 * A settings or account page for this person, or not found: a page their role
 * doesn't open is answered as if it didn't exist, as before. Gives the
 * workspace and the page's header.
 */
export async function openManagePage<G extends ManageGroup>(
  workspace: string,
  group: G,
  slug: PageOf[G],
) {
  const view = await loadWorkspaceView(workspace);
  const pages: readonly ManagePage[] =
    group === "settings" ? settingsPages : accountPages;
  const page = pages.find((item) => item.slug === slug);
  if (!page || !canOpen(page, view, deploymentMode() === "cloud")) notFound();
  return {
    view,
    header: <PageHeader title={page.label} purpose={page.purpose} />,
  };
}

/** The layout of `/<workspace>/settings` and `/<workspace>/account`. */
export async function ManageSection({
  group,
  workspace,
  children,
}: {
  group: ManageGroup;
  workspace: string;
  children: ReactNode;
}) {
  const view = await loadWorkspaceView(workspace);
  return (
    <ManageLayout
      group={group}
      showBilling={deploymentMode() === "cloud"}
      workspace={view.slug}
      access={{ capabilities: view.capabilities, isOwner: view.isOwner }}
    >
      {children}
    </ManageLayout>
  );
}
