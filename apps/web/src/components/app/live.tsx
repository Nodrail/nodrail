"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** How often an open page checks for news while it is visible. */
export const LIVE_INTERVAL_MS = 20_000;

/**
 * Calls `onTick` when the window regains focus or the tab is shown again,
 * and every `interval` while it stays visible. Nothing runs in a hidden tab.
 */
export function useLiveTick(onTick: () => void, interval = LIVE_INTERVAL_MS) {
  const latest = useRef(onTick);
  useEffect(() => {
    latest.current = onTick;
  });
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = window.setInterval(tick, interval);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [interval]);
}

/**
 * Whether the person is in the middle of something a refresh could move
 * under them: a dialog or menu open, a row on its way out after a decision,
 * a form waiting for its answer, or typing in a field.
 */
export function isBusy(doc: Document = document) {
  if (
    doc.querySelector(
      "dialog[open], [role=dialog], [role=menu], [data-leaving], form[aria-busy=true]",
    )
  )
    return true;
  const active = doc.activeElement;
  return (
    active instanceof HTMLElement &&
    (active.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))
  );
}

/**
 * Keeps a page current: on focus and every 20 seconds it asks the server
 * for the page again, so new decisions and check-ins show without a
 * reload. It waits while the person is busy, so rows never jump while
 * they work. Server components re-render; what people typed stays.
 */
export function LiveRefresh({ interval }: { interval?: number }) {
  const router = useRouter();
  useLiveTick(() => {
    if (!isBusy()) router.refresh();
  }, interval);
  return null;
}

/**
 * Reads JSON from `href` on every tick and hands it to `onData`. A failed
 * read changes nothing: what is shown stays, and the next tick asks again.
 */
export function useLiveJson<T>(
  href: string,
  onData: (body: T) => void,
  interval?: number,
) {
  useLiveTick(() => {
    void fetch(href, { cache: "no-store" })
      .then((response) =>
        response.ok ? (response.json() as Promise<T>) : null,
      )
      .then((body) => {
        if (body !== null) onData(body);
      })
      .catch(() => {});
  }, interval);
}
