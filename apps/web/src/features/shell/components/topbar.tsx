"use client";

import { Check, ChevronDown, PanelLeft } from "lucide-react";
import { StatusBadge } from "@/components/app/status-badge";
import { focusRing } from "@/components/app/styles";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { signOut } from "@/features/auth/actions";
import { ConsentSettingsButton } from "@nodrail/web-shared/analytics/consent";
import { HelpMenu } from "@/features/guidance/components/help-menu";
import type { Ref } from "react";
import { cn } from "@/lib/utils";
import { EnvironmentBadge } from "./environment-badge";
import {
  accountPages,
  canOpen,
  roleLabels,
  settingsPages,
  type ManagePage,
} from "../navigation";
import type { PlanHint } from "../usage-banner";
import {
  MenuDivider,
  MenuLabel,
  MenuLink,
  ShellMenu,
  menuItem,
} from "./shell-menu";
import { appPath } from "@/lib/product-path";

/** A square icon button in the top bar, larger on phones. */
const utilityTrigger = cn(
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground phone:size-10 [&_svg]:size-4.5",
  focusRing,
);

/** The workspace name, shrinking first when a phone's top bar is full. */
const workspaceTrigger = cn(
  "flex min-w-0 items-center gap-2.25 rounded-md px-1.5 py-1 text-ui font-semibold whitespace-nowrap text-foreground transition-colors duration-150 hover:bg-muted phone:min-h-10",
  focusRing,
);

const avatar =
  "grid place-items-center bg-selected text-micro font-bold text-foreground";

/** First letters of the first two words; a single word gives its first two. */
export function initials(name: string) {
  const words = name
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);
  const [first, second] = words;
  const letters = second
    ? `${first?.[0] ?? ""}${second[0] ?? ""}`
    : (first ?? "").slice(0, 2);
  return letters.toUpperCase();
}

/** Links to a group's pages this person may open, marking the open one. */
function PageLinks({
  view,
  group,
  pages,
  path,
  hints = {},
  showBilling = true,
}: {
  view: WorkspaceViewDto;
  group: "settings" | "account";
  pages: readonly ManagePage[];
  path: string;
  hints?: Record<string, string>;
  showBilling?: boolean;
}) {
  return pages
    .filter((page) => canOpen(page, view, showBilling))
    .map((page) => {
      const current = path === `/${group}/${page.slug}`;
      return (
        <MenuLink
          key={page.slug}
          href={appPath(view.slug, group, page.slug)}
          aria-current={current ? "page" : undefined}
        >
          {page.label}
          {hints[page.slug] ? (
            <span className="text-xs text-muted-foreground">
              {hints[page.slug]}
            </span>
          ) : null}
        </MenuLink>
      );
    });
}

/**
 * Each environment, keeping the current section; from a settings or account
 * page, which is in no environment, the environment's Overview.
 */
function EnvironmentLinks({
  view,
  environmentSlug,
  section,
  activitySearch,
}: {
  view: WorkspaceViewDto;
  environmentSlug: string;
  section: string | null;
  activitySearch: string;
}) {
  const query = new URLSearchParams(
    section === "/activity" ? activitySearch : "",
  );
  for (const key of ["agent", "run", "event", "cursor"]) query.delete(key);
  const search = query.toString();
  const targetSection =
    section === "/activity" && search
      ? `/activity?${search}`
      : (section ?? "/overview");
  return (
    <>
      <MenuLabel>Environment</MenuLabel>
      {view.environments.map((item) => (
        <MenuLink
          key={item.id}
          href={appPath(view.slug, `${item.slug}${targetSection}`)}
          aria-current={item.slug === environmentSlug ? "true" : undefined}
        >
          {item.name}
          {item.slug === environmentSlug ? <Check aria-hidden="true" /> : null}
        </MenuLink>
      ))}
    </>
  );
}

/** Settings, Members and Billing; Data is a step further, in the sub-menu. */
const workspaceMenuPages: ManagePage[] = settingsPages
  .filter((page) => page.slug !== "data")
  .map((page) =>
    page.slug === "general" ? { ...page, label: "Settings" } : page,
  );

function WorkspaceIdentity({
  name,
  environment,
}: {
  name: string;
  environment?: string;
}) {
  return (
    <>
      <span
        className={cn(avatar, "size-6 rounded-md phone:hidden")}
        aria-hidden="true"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <span className="max-w-55 min-w-0 truncate phone:max-w-45">{name}</span>
      <span className="sr-only">, {environment}</span>
      <ChevronDown
        aria-hidden="true"
        className="size-3.5 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
      />
    </>
  );
}

/**
 * The workspace: its plan, which environment the sidebar works in, its
 * settings, and the other workspaces.
 */
function WorkspaceMenu({
  view,
  environmentSlug,
  path,
  section,
  activitySearch,
  plan,
  showBilling,
}: {
  view: WorkspaceViewDto;
  environmentSlug: string;
  path: string;
  section: string | null;
  activitySearch: string;
  plan: PlanHint | null;
  showBilling: boolean;
}) {
  const environment = view.environments.find(
    (item) => item.slug === environmentSlug,
  );
  const usage =
    typeof plan?.percent === "number" ? `${plan.percent}% used` : undefined;
  return (
    <ShellMenu
      slot="workspace-menu"
      align="start"
      triggerClassName={workspaceTrigger}
      trigger={
        <WorkspaceIdentity name={view.name} environment={environment?.name} />
      }
    >
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.75">
        <b className="truncate">{view.name}</b>
        {plan ? (
          <span data-slot="plan-badge">
            <StatusBadge tone="neutral">{plan.plan}</StatusBadge>
          </span>
        ) : null}
      </div>
      <MenuDivider />
      <EnvironmentLinks
        view={view}
        environmentSlug={environmentSlug}
        section={section}
        activitySearch={activitySearch}
      />
      <MenuDivider />
      <MenuLabel>Workspace</MenuLabel>
      <PageLinks
        view={view}
        group="settings"
        pages={workspaceMenuPages}
        path={path}
        showBilling={showBilling}
        hints={usage ? { billing: usage } : {}}
      />
      <MenuDivider />
      <MenuLabel>Switch workspace</MenuLabel>
      {view.otherWorkspaces.map((workspace) => (
        <MenuLink key={workspace.id} href={appPath(workspace.slug)}>
          {workspace.name}
        </MenuLink>
      ))}
      <MenuLink href={appPath("new")}>Create a workspace</MenuLink>
    </ShellMenu>
  );
}

/** Who is signed in and their role, their own pages, cookies and sign out. */
function AccountMenu({ view, path }: { view: WorkspaceViewDto; path: string }) {
  return (
    <ShellMenu
      slot="account-menu"
      label={`${initials(view.person.name)}, your account`}
      triggerClassName={utilityTrigger}
      trigger={
        <span className={cn(avatar, "size-7 rounded-full")} aria-hidden="true">
          {initials(view.person.name)}
        </span>
      }
    >
      <b>{view.person.name}</b>
      {view.person.email ? <small>{view.person.email}</small> : null}
      <span data-slot="account-role" className="mt-2.5 text-xs text-forest">
        {view.isOwner ? "Owner" : roleLabels[view.role]}
      </span>
      <MenuDivider />
      <PageLinks view={view} group="account" pages={accountPages} path={path} />
      <MenuDivider />
      <ConsentSettingsButton label="Cookie settings" className={menuItem} />
      <form action={signOut}>
        <button type="submit" className={menuItem}>
          Sign out
        </button>
      </form>
    </ShellMenu>
  );
}

/** The bar above every workspace page: sidebar toggle, workspace and account. */
export function Topbar({
  view,
  environmentSlug,
  path,
  section,
  activitySearch,
  plan = null,
  showBilling = true,
  expanded,
  onToggle,
  toggleRef,
}: {
  view: WorkspaceViewDto;
  environmentSlug: string;
  /** The page's path below the workspace, such as `/development/agents`. */
  path: string;
  /** The page's path below the environment; null on settings and account. */
  section: string | null;
  activitySearch: string;
  plan?: PlanHint | null;
  showBilling?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** Where focus returns when the phone drawer closes. */
  toggleRef?: Ref<HTMLButtonElement>;
}) {
  const environment = view.environments.find(
    (item) => item.slug === environmentSlug,
  );
  return (
    <header
      data-slot="topbar"
      className="sticky top-0 z-15 flex h-14 items-center justify-between gap-5 border-b bg-card px-6 phone:gap-2 phone:px-3"
    >
      <div className="flex min-w-0 items-center gap-3.5 phone:gap-2">
        <button
          ref={toggleRef}
          type="button"
          className={utilityTrigger}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          aria-controls="sidebar"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <PanelLeft aria-hidden="true" />
        </button>
        <span className="h-4.5 w-px bg-border phone:hidden" />
        <WorkspaceMenu
          view={view}
          environmentSlug={environmentSlug}
          path={path}
          section={section}
          activitySearch={activitySearch}
          plan={plan}
          showBilling={showBilling}
        />
        {environment ? (
          <EnvironmentBadge slug={environment.slug} name={environment.name} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 phone:gap-0.5">
        <HelpMenu
          base={appPath(view.slug, environmentSlug)}
          path={path}
          triggerClassName={utilityTrigger}
        />
        <AccountMenu view={view} path={path} />
      </div>
    </header>
  );
}
