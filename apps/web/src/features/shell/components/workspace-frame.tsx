import "server-only";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { readForPage } from "@/features/shell/load-view";
import { settingsPath } from "@/features/shell/navigation";
import {
  SIDEBAR_COOKIE,
  sidebarCollapsed,
} from "@/features/shell/sidebar-preference";
import { planHint, usageBanner } from "@/features/shell/usage-banner";
import { getUsageNotice } from "@/server/modules/billing/metering";
import { readGuidance } from "@/server/modules/guidance";
import { AppFrame } from "./app-frame";

/**
 * Every workspace page's frame: sidebar, top bar, guidance and the usage
 * banner. Pages in an environment pass theirs; settings and account pages
 * pass the one the sidebar's links lead to.
 */
export async function WorkspaceFrame({
  view,
  environment,
  children,
}: {
  view: WorkspaceViewDto;
  environment: string;
  children: ReactNode;
}) {
  const { guidance, usage } = await readForPage(view.slug, async (context) => ({
    guidance: await readGuidance(context),
    usage: await getUsageNotice(context),
  }));
  const showBilling = usage.deployment === "cloud";
  const canManageBilling = view.capabilities.includes("workspace:settings");
  const preference = (await cookies()).get(SIDEBAR_COOKIE)?.value;
  return (
    <AppFrame
      view={view}
      environmentSlug={environment}
      initialCollapsed={sidebarCollapsed(preference)}
      guidance={guidance}
      showBilling={showBilling}
      plan={showBilling ? planHint(usage, canManageBilling) : null}
      usageBanner={usageBanner(usage, {
        canManageBilling,
        billingHref: settingsPath(view.slug, "billing"),
        personId: view.person.id,
        workspaceId: view.id,
      })}
    >
      {children}
    </AppFrame>
  );
}
