"use client";

import { CircleHelp } from "lucide-react";
import { useRef, type MouseEvent } from "react";
import { track } from "@/components/analytics/posthog";
import { WHATS_NEW_KEY } from "@/contracts/v1/guidance";
import {
  MenuDivider,
  MenuLabel,
  ShellMenu,
  menuItem,
} from "@/features/shell/components/shell-menu";
import { cn } from "@/lib/utils";
import { tourForPath } from "../tours";
import { hasUnread, whatsNew } from "../whats-new";
import { useGuidance } from "./guidance-provider";
import { WhatsNewDialog } from "./whats-new-dialog";

const docs = [
  { label: "Quickstart", href: "/docs/quickstart" },
  { label: "Writing rules", href: "/docs/rules" },
  { label: "Runs, gates and budgets", href: "/docs/runs" },
  { label: "All documentation", href: "/docs" },
];

/** The menu's own button, which focus returns to once a menu item is done. */
function closeMenu(event: MouseEvent<HTMLElement>) {
  const menu = event.currentTarget.closest("details");
  if (menu) menu.open = false;
  return menu?.querySelector("summary") ?? null;
}

/** A dot that says there is something unread, with words for screen readers. */
function UnreadDot({ label }: { label: string }) {
  return (
    <span
      data-slot="unread-dot"
      className="size-2 shrink-0 rounded-full bg-forest"
      role="img"
      aria-label={label}
    />
  );
}

/**
 * Help in the top bar: this page's tour, what changed in the product (with a
 * dot until this person has read the newest entry) and the documentation.
 */
export function HelpMenu({
  base,
  path,
  triggerClassName,
}: {
  /** The environment's path, which What's new links continue. */
  base: string;
  /** The page's path below the workspace, such as `/development/activity`. */
  path: string;
  triggerClassName: string;
}) {
  const { startTour, valueOf, mark } = useGuidance();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const tour = tourForPath(path);
  const unread = hasUnread(valueOf(WHATS_NEW_KEY));

  function openWhatsNew(event: MouseEvent<HTMLButtonElement>) {
    trigger.current = closeMenu(event);
    dialog.current?.showModal();
    track("whats_new_opened");
    const [latest] = whatsNew;
    if (latest && unread) void mark(WHATS_NEW_KEY, latest.id);
  }

  return (
    <>
      <ShellMenu
        slot="help-menu"
        label={unread ? "Help, with something new" : "Help"}
        triggerClassName={cn("relative", triggerClassName)}
        trigger={
          <>
            <CircleHelp aria-hidden="true" />
            {unread ? (
              <span
                aria-hidden="true"
                className="absolute top-1 right-1 size-2 rounded-full border-2 border-card bg-forest phone:top-2 phone:right-2"
              />
            ) : null}
          </>
        }
      >
        <MenuLabel>Help</MenuLabel>
        {tour ? (
          <button
            type="button"
            className={menuItem}
            onClick={(event) =>
              startTour(tour, { returnFocus: closeMenu(event) })
            }
          >
            Take the tour of this page
          </button>
        ) : null}
        <button type="button" className={menuItem} onClick={openWhatsNew}>
          What&apos;s new
          {unread ? <UnreadDot label="Unread" /> : null}
        </button>
        <MenuDivider />
        <MenuLabel>Documentation</MenuLabel>
        {docs.map((item) => (
          <a key={item.href} href={item.href} className={menuItem}>
            {item.label}
          </a>
        ))}
      </ShellMenu>
      <WhatsNewDialog
        ref={dialog}
        base={base}
        onClose={() => trigger.current?.focus()}
      />
    </>
  );
}
