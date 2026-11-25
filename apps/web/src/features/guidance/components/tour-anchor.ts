"use client";

import { useEffect, useMemo, useState } from "react";

type Measurable = { getBoundingClientRect: () => DOMRect };

/** Whether an element takes up room on screen (phones hide some outright). */
function isShown(element: HTMLElement) {
  if (element.getClientRects().length === 0) return false;
  const { width, height } = element.getBoundingClientRect();
  return (
    width > 0 && height > 0 && getComputedStyle(element).visibility !== "hidden"
  );
}

/** The step's element, if the page shows it now. */
function findAnchor(name: string): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(
    `[data-tour="${CSS.escape(name)}"]`,
  );
  return element && isShown(element) ? element : null;
}

/** A point in the middle of the window, for a step with nothing to point at. */
const middle: Measurable = {
  getBoundingClientRect: () =>
    DOMRect.fromRect({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      width: 0,
      height: 0,
    }),
};

const prefersLessMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function inView(element: HTMLElement) {
  const { top, bottom } = element.getBoundingClientRect();
  return top >= 0 && bottom <= window.innerHeight;
}

/**
 * The element a step points at, looked up again when the window changes size
 * (a phone layout can hide it), scrolled into view and outlined while the
 * step is open. Without one, the step sits in the middle of the window.
 */
export function useTourAnchor(name: string) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const update = () => setTarget(findAnchor(name));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [name]);

  useEffect(() => {
    if (!target) return;
    if (!inView(target))
      target.scrollIntoView?.({
        block: "center",
        behavior: prefersLessMotion() ? "auto" : "smooth",
      });
    target.setAttribute("data-tour-active", "");
    return () => target.removeAttribute("data-tour-active");
  }, [target]);

  const anchor = useMemo(() => ({ current: target ?? middle }), [target]);
  return { target, anchor };
}

const tabbable =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside the container, wrapping at either end. */
export function keepTabInside(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(tabbable),
  ];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !items.includes(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
