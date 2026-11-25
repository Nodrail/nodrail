"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { eyebrow, focusRing } from "@/components/app/styles";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { PageTour } from "@/features/guidance/components/page-tour";
import { appPath } from "@/lib/product-path";
import { cn } from "@/lib/utils";
import { accountPages, canOpen, settingsPages } from "../navigation";

const groups = {
  settings: {
    label: "Workspace settings",
    tour: "settings-nav",
    pages: settingsPages,
  },
  account: { label: "Your account", tour: "account-nav", pages: accountPages },
} as const;

export type ManageGroup = keyof typeof groups;

/**
 * Workspace settings or your account: a side menu of the group's pages this
 * person may open (a row that scrolls on phones), and the open page beside it.
 * The menu and each link are tour anchors, so the tour works from any page.
 */
export function ManageLayout({
  group,
  workspace,
  access,
  showBilling,
  children,
}: {
  group: ManageGroup;
  workspace: string;
  access: Pick<WorkspaceViewDto, "capabilities" | "isOwner">;
  showBilling: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { label, tour, pages } = groups[group];
  return (
    <div className="grid grid-cols-[12.5rem_minmax(0,1fr)] items-start gap-8 phone:grid-cols-1 phone:gap-4">
      <nav
        aria-label={label}
        data-slot="manage-nav"
        data-tour={tour}
        className="sticky top-20 grid gap-1 phone:static"
      >
        <span className={cn("mb-1.5 px-[11px] phone:hidden", eyebrow)}>
          {label}
        </span>
        <ul className="grid gap-1 phone:flex phone:overflow-x-auto phone:pb-1">
          {pages
            .filter((page) => canOpen(page, access, showBilling))
            .map((page) => {
              const href = appPath(workspace, group, page.slug);
              return (
                <li key={page.slug} className="shrink-0">
                  <Link
                    href={href}
                    data-tour={page.tour}
                    aria-current={pathname === href ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center rounded-lg px-[11px] text-ui font-medium whitespace-nowrap text-body transition-colors duration-200 hover:bg-accent aria-[current=page]:bg-selected aria-[current=page]:text-foreground",
                      focusRing,
                    )}
                  >
                    {page.label}
                  </Link>
                </li>
              );
            })}
        </ul>
      </nav>
      <div className="min-w-0">{children}</div>
      <PageTour tour={group} ready />
    </div>
  );
}
