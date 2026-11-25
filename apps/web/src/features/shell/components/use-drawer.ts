"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { phoneMedia } from "@/components/app/styles";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(phoneMedia);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True on phones (`phone:`); false on the server and on wide screens. */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(phoneMedia).matches,
    () => false,
  );
}

/**
 * The phone navigation drawer, as a modal: opening it moves focus into it,
 * the rest of the frame is inert while it is open, and Escape or the scrim
 * close it and give focus back to the toggle. Navigating or widening the
 * window closes it quietly.
 */
export function useDrawer(pathname: string, phone: boolean) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocus = useRef(false);

  const close = useCallback(() => {
    returnFocus.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname, phone]);

  useEffect(() => {
    if (open) {
      const links = drawerRef.current?.querySelectorAll<HTMLElement>("a");
      const current = drawerRef.current?.querySelector<HTMLElement>(
        "a[aria-current=page]",
      );
      (current ?? links?.[0])?.focus();
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") close();
      };
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    if (returnFocus.current) toggleRef.current?.focus();
    returnFocus.current = false;
  }, [open, close]);

  return { open, setOpen, close, toggleRef, drawerRef };
}
