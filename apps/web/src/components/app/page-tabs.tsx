"use client";

import Link from "next/link";
import { tabsListVariants } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

export type PageTab = {
  /** Stable name of the tab, compared with `current`. */
  value: string;
  label: string;
  href: string;
  /** A `data-tour` anchor, when a tour points at this tab. */
  tour?: string;
};

/**
 * A page's sections as shadcn line tabs, each one its own address: links in
 * a `nav`, the open one marked `aria-current="page"`. Unlike Tabs, every
 * section can be linked to, reloaded and opened in a new tab.
 */
export function PageTabs({
  label,
  tabs,
  current,
  tour,
}: {
  label: string;
  tabs: PageTab[];
  current: string;
  tour?: string;
}) {
  return (
    <nav
      aria-label={label}
      data-slot="page-tabs"
      data-tour={tour}
      className="mb-4 max-w-full overflow-x-auto border-b"
    >
      <div
        data-variant="line"
        className={cn(tabsListVariants({ variant: "line" }), "h-9 p-0")}
      >
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={tab.href}
            data-tour={tab.tour}
            aria-current={tab.value === current ? "page" : undefined}
            className={cn(
              "relative inline-flex h-full items-center rounded-md px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground",
              "after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity aria-[current=page]:after:opacity-100",
              focusRing,
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
