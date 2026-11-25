"use client";

import { useEffect } from "react";

export const LEAVE_MESSAGE =
  "Your edits to the rules are not published. Leave and lose them?";

/** A link that would take the person to another page of this app. */
function leavingLink(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return null;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.target === "_blank")
    return null;
  if (link.hasAttribute("download")) return null;
  const to = new URL(link.href, window.location.href);
  if (to.origin !== window.location.origin) return null;
  return to.pathname === window.location.pathname ? null : link;
}

/**
 * Asks before unpublished edits are lost: on reload or close through the
 * browser, and on links inside the app, which the browser doesn't ask about.
 */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (!leavingLink(event) || window.confirm(LEAVE_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [active]);
}
