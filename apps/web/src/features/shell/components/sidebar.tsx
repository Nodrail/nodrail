"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactElement, Ref } from "react";
import { eyebrow, focusRing } from "@/components/app/styles";
import { Logo } from "@nodrail/web-shared/logo";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { workspaceSections, type ShellSection } from "../navigation";

/**
 * Shows a slow navigation has started: a pulsing bar over the link's left
 * edge, out of flow so the icon, text and count never move. Pages stay
 * unstreamed for exact 404s.
 */
function NavPending() {
  const { pending } = useLinkStatus();
  return pending ? (
    <i
      aria-hidden="true"
      data-slot="nav-pending"
      className="absolute top-1/2 left-0 h-4 w-0.75 -translate-y-1/2 animate-pulse-dot rounded-full bg-forest"
    />
  ) : null;
}

/**
 * On the icon rail, a link's name beside it while it has keyboard focus or
 * the pointer; Escape hides it. Elsewhere the name is already on screen.
 */
function RailLabel({
  rail,
  text,
  children,
}: {
  rail: boolean;
  text: string;
  children: ReactElement;
}) {
  if (!rail) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} data-slot="rail-label">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function NavigationList({
  label,
  sections,
  base,
  pathname,
  collapsed,
  rail,
}: {
  label: string;
  sections: ShellSection[];
  base: string;
  pathname: string;
  collapsed: boolean;
  rail: boolean;
}) {
  return (
    <nav aria-label={label} className="grid gap-1.25">
      {sections.map(({ slug, label: text, icon: Icon }) => {
        const href = `${base}/${slug}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <RailLabel key={slug} rail={rail} text={text}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-2.75 rounded-lg px-2.75 text-ui font-medium whitespace-nowrap text-body transition-colors duration-200 hover:bg-accent aria-[current=page]:bg-selected aria-[current=page]:text-foreground",
                focusRing,
                collapsed && "wide:justify-center wide:px-0",
              )}
            >
              <Icon aria-hidden="true" className="size-4.5 shrink-0" />
              <span
                data-slot="nav-text"
                className={cn(collapsed && "wide:sr-only")}
              >
                {text}
              </span>
              <NavPending />
            </Link>
          </RailLabel>
        );
      })}
    </nav>
  );
}

function NavLabel({
  collapsed,
  children,
}: {
  collapsed: boolean;
  children: string;
}) {
  return (
    <p className={cn("mx-2.75 my-2.5", eyebrow, collapsed && "wide:hidden")}>
      {children}
    </p>
  );
}

/**
 * The workspace sidebar: 224px, a 72px icon rail when collapsed on desktop,
 * and a drawer that slides in on phones (`phone:`, 780px and narrower). The
 * closed drawer is invisible, so nothing in it takes focus; the open one is a
 * modal dialog (`modal`).
 */
export function Sidebar({
  ref,
  base,
  pathname,
  collapsed,
  rail,
  drawerOpen,
  modal,
}: {
  ref?: Ref<HTMLElement>;
  base: string;
  pathname: string;
  collapsed: boolean;
  /** The icon rail is showing: collapsed on a wide screen. */
  rail: boolean;
  drawerOpen: boolean;
  modal: boolean;
}) {
  return (
    <aside
      ref={ref}
      id="sidebar"
      data-slot="sidebar"
      aria-label="Workspace navigation"
      role={modal ? "dialog" : undefined}
      aria-modal={modal ? true : undefined}
      className={cn(
        "fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r bg-sidebar px-3 pb-3 transition-[width] duration-150 ease-out",
        // Visible at once on opening, so focus can move in; hidden only once
        // it has slid out on closing.
        drawerOpen
          ? "phone:visible phone:translate-x-0 phone:transition-transform"
          : "phone:invisible phone:-translate-x-full phone:transition-[transform,visibility]",
        collapsed && "wide:w-18",
      )}
    >
      <Link
        href={`${base}/overview`}
        aria-label="Nodrail home"
        className={cn(
          "-mx-3 mb-3 flex h-14 shrink-0 items-center border-b px-4.75 focus-visible:ring-inset",
          focusRing,
          collapsed && "wide:justify-center wide:px-0",
        )}
      >
        <Logo
          alt=""
          className={cn("h-auto w-30", collapsed && "wide:hidden")}
        />
        <Logo
          variant="symbol"
          alt=""
          className={cn("hidden h-8 w-7.5", collapsed && "wide:block")}
        />
      </Link>
      <NavLabel collapsed={collapsed}>Workspace</NavLabel>
      <TooltipProvider delayDuration={150}>
        <NavigationList
          label="Main navigation"
          sections={workspaceSections}
          base={base}
          pathname={pathname}
          collapsed={collapsed}
          rail={rail}
        />
      </TooltipProvider>
    </aside>
  );
}
