"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  clearAnalyticsWorkspace,
  setAnalyticsIdentity,
} from "@/components/analytics/posthog";
import { ToastProvider } from "@/components/app/toast";
import type { GuidanceDto } from "@/contracts/v1/guidance";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { GuidanceProvider } from "@/features/guidance/components/guidance-provider";
import { cn } from "@/lib/utils";
import {
  browserEnvironment,
  rememberEnvironment,
} from "../environment-preference";
import { rememberSidebar } from "../sidebar-preference";
import { Sidebar } from "./sidebar";
import { Topbar, initials } from "./topbar";
import { UsageBanner } from "./usage-banner";
import { useDrawer, useIsPhone } from "./use-drawer";
import type { PlanHint, UsageBannerState } from "../usage-banner";
import { appPath } from "@/lib/product-path";

export { initials };

/** `/b/c` for `/a/b/c` below `/a`; `""` for `/a` itself; null outside it. */
export function pathBelow(prefix: string, pathname: string) {
  if (pathname === prefix) return "";
  return pathname.startsWith(`${prefix}/`)
    ? pathname.slice(prefix.length)
    : null;
}

const subscribeEnvironment = () => () => {};

function useCurrentEnvironment(
  view: WorkspaceViewDto,
  path: string,
  initialEnvironment: string,
) {
  const managed = /^\/(account|settings)(\/|$)/.test(path);
  const remembered = useSyncExternalStore(
    subscribeEnvironment,
    () => (managed ? browserEnvironment(view.slug) : undefined),
    () => undefined,
  );
  const environmentSlug = view.environments.some(
    (item) => item.slug === remembered,
  )
    ? (remembered ?? initialEnvironment)
    : initialEnvironment;
  useEffect(() => {
    if (!managed) rememberEnvironment(view.slug, initialEnvironment);
  }, [managed, view.slug, initialEnvironment]);
  return environmentSlug;
}

export function AppFrame({
  view,
  environmentSlug: initialEnvironment,
  guidance = {},
  usageBanner = null,
  plan = null,
  showBilling = true,
  initialCollapsed = false,
  children,
}: {
  view: WorkspaceViewDto;
  environmentSlug: string;
  /** What this person has seen of tours, first steps and "What's new". */
  guidance?: GuidanceDto;
  usageBanner?: UsageBannerState | null;
  /** The plan badge in the workspace menu. */
  plan?: PlanHint | null;
  showBilling?: boolean;
  /** The person's remembered icon rail, read by the server from a cookie. */
  initialCollapsed?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const path = pathBelow(appPath(view.slug), pathname) ?? "";
  const environmentSlug = useCurrentEnvironment(view, path, initialEnvironment);
  const phone = useIsPhone();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const drawer = useDrawer(pathname, phone);

  useEffect(() => {
    setAnalyticsIdentity(view.person.id, view.id);
    return clearAnalyticsWorkspace;
  }, [view.person.id, view.id]);

  function toggle() {
    if (phone) {
      drawer.setOpen((open) => !open);
      return;
    }
    rememberSidebar(!collapsed);
    setCollapsed(!collapsed);
  }

  const base = appPath(view.slug, environmentSlug);
  // Settings and account pages are in no environment: they have no section.
  const section = pathBelow(`/${environmentSlug}`, path);
  // While the drawer is open, only it and its scrim can be reached.
  const covered = phone && drawer.open;

  return (
    <ToastProvider>
      <GuidanceProvider initial={guidance}>
        <div className="min-h-dvh bg-background text-body">
          <a href="#page" className="skip-link" inert={covered}>
            Skip to content
          </a>
          <Sidebar
            ref={drawer.drawerRef}
            base={base}
            pathname={pathname}
            collapsed={collapsed}
            rail={collapsed && !phone}
            drawerOpen={drawer.open}
            modal={covered}
          />
          {covered ? (
            <button
              type="button"
              className="fixed inset-0 z-25 animate-in border-0 bg-ink/25 duration-150 fade-in-0 wide:hidden"
              aria-label="Close navigation"
              onClick={drawer.close}
            />
          ) : null}
          <div
            inert={covered}
            className={cn(
              "ml-56 transition-[margin-left] duration-150 ease-out phone:ml-0",
              collapsed && "wide:ml-18",
            )}
          >
            <Topbar
              view={view}
              environmentSlug={environmentSlug}
              path={path}
              section={section}
              activitySearch={search?.toString() ?? ""}
              plan={plan}
              showBilling={showBilling}
              expanded={phone ? drawer.open : !collapsed}
              onToggle={toggle}
              toggleRef={drawer.toggleRef}
            />
            <UsageBanner state={usageBanner} />
            <main
              id="page"
              tabIndex={-1}
              className="px-8 pt-6 pb-12 outline-none phone:px-4 phone:pt-5 phone:pb-10"
            >
              {children}
            </main>
          </div>
        </div>
      </GuidanceProvider>
    </ToastProvider>
  );
}
