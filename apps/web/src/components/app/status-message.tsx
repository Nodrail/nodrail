"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A confirmation that replaces or follows what the person just used. The
 * status region is in the page from the start, empty, so screen readers
 * announce it when it fills; once shown it takes the focus, which would
 * otherwise fall back to the page as the form or button it follows goes.
 */
export function StatusMessage({
  show,
  className,
  children,
}: {
  show: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (show) ref.current?.focus();
  }, [show]);
  return (
    <p
      ref={ref}
      role="status"
      tabIndex={-1}
      data-slot="status-message"
      className={cn(
        show
          ? "animate-in duration-200 fade-in-0 slide-in-from-bottom-1"
          : "sr-only",
        show && className,
      )}
    >
      {show ? children : null}
    </p>
  );
}
