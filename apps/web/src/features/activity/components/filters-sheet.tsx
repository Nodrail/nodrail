"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { phoneMedia } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const subscribe = (change: () => void) => {
  // Some environments, such as test runners, have no media queries.
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(phoneMedia);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
};

const isPhone = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia(phoneMedia).matches;

/** Whether the screen is a phone's; false on the server and without media queries. */
export function usePhone() {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}

/**
 * On a phone, the filters behind one "Filters (n)" button, in a sheet from
 * the bottom; `count` is how many narrow the list now.
 */
export function FiltersSheet({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        data-slot="filters-button"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {count ? `Filters (${count})` : "Filters"}
      </Button>
      <SheetContent
        side="bottom"
        data-slot="filters-sheet"
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl bg-background text-body"
      >
        <SheetHeader className="border-b p-4 pr-12">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Each change applies at once.</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 p-4 *:w-full">{children}</div>
        <div className="border-t p-4">
          <Button
            type="button"
            className="w-full"
            onClick={() => setOpen(false)}
          >
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
