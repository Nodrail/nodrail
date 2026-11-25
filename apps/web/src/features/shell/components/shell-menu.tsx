"use client";

import Link from "next/link";
import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { eyebrow, focusRing } from "@/components/app/styles";
import { cn } from "@/lib/utils";

/** A link or button row inside a ShellMenu; `aria-current` marks the chosen one. */
export const menuItem = cn(
  "flex w-full cursor-pointer items-center justify-between rounded-md px-1.5 py-2.25 text-left text-body transition-colors duration-150 hover:bg-muted aria-[current]:bg-selected aria-[current]:text-foreground",
  focusRing,
);

/** A link row inside a ShellMenu. */
export function MenuLink({ className, ...props }: ComponentProps<typeof Link>) {
  return <Link className={cn(menuItem, className)} {...props} />;
}

/** A group label inside a ShellMenu, such as "Workspaces". */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <span className={cn("mb-2", eyebrow)}>{children}</span>;
}

/** A full-width rule between groups of a ShellMenu. */
export function MenuDivider() {
  return <div className="-mx-3.75 my-3.25 h-px bg-border" />;
}

/**
 * A disclosure menu that closes on Escape, outside clicks, navigation and
 * when focus moves to something outside it, so it never covers the focused
 * control. On phones it scrolls when taller than the screen.
 */
export function ShellMenu({
  label,
  trigger,
  triggerClassName,
  slot,
  align = "end",
  children,
}: {
  label?: string;
  trigger: ReactNode;
  triggerClassName: string;
  /** Names the menu for tests: `[data-slot=<slot>]`. */
  slot: string;
  /** Which edge of the trigger the popover lines up with. */
  align?: "start" | "end";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const menu = ref.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        menu.open = false;
        menu.querySelector("summary")?.focus();
        return;
      }
      const target = event.target as Node;
      if (!menu.contains(target) || (target as Element).closest?.("a"))
        menu.open = false;
    };
    // Only when focus lands elsewhere: a click on the menu's own text moves
    // focus to nothing, and outside clicks are handled above.
    const leave = (event: FocusEvent) => {
      const menu = ref.current;
      const next = event.relatedTarget as Node | null;
      if (menu?.open && next && !menu.contains(next)) menu.open = false;
    };
    const menu = ref.current;
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    menu?.addEventListener("focusout", leave);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
      menu?.removeEventListener("focusout", leave);
    };
  }, []);

  return (
    <details ref={ref} data-slot={slot} className="group relative min-w-0">
      <summary
        className={cn(
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          triggerClassName,
        )}
        aria-label={label}
      >
        {trigger}
      </summary>
      <div
        className={cn(
          "absolute top-[calc(100%+12px)] z-20 grid w-66 rounded-lg border bg-popover p-4 text-ui shadow-lg shadow-ink/10",
          "duration-150 group-open:animate-in group-open:fade-in-0 group-open:zoom-in-95 group-open:slide-in-from-top-1",
          "[&_small]:mt-0.75 [&_small]:truncate [&_small]:text-xs [&_small]:text-muted-foreground [&_svg]:size-4 [&_svg]:text-forest",
          "phone:fixed phone:top-13 phone:max-h-[calc(100dvh-64px)] phone:w-[min(300px,calc(100vw-24px))] phone:overflow-y-auto phone:overscroll-contain",
          align === "end" ? "right-0 phone:right-3" : "left-0 phone:left-3",
        )}
      >
        {children}
      </div>
    </details>
  );
}
