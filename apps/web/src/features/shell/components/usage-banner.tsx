"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { track } from "@/components/analytics/posthog";
import { focusRing } from "@/components/app/styles";
import { TextLink } from "@/components/app/text-link";
import { toneLooks } from "@/components/app/tones";
import { cn } from "@/lib/utils";
import type { UsageBannerState } from "../usage-banner";

/** Storage can be blocked; then the banner simply comes back next time. */
function remembered(key: string) {
  try {
    return window.localStorage.getItem(key) === "dismissed";
  } catch {
    return false;
  }
}

function remember(key: string) {
  try {
    window.localStorage.setItem(key, "dismissed");
  } catch {
    // Nothing to keep it in: it shows again on the next page load.
  }
}

/** A slim line over every product page while an allowance is nearly or fully used. */
export function UsageBanner({ state }: { state: UsageBannerState | null }) {
  // Hidden until the browser says whether it was dismissed, so a dismissed
  // banner never flashes in.
  const [hidden, setHidden] = useState(true);
  const { dismissKey, metric, threshold } = state ?? {};

  // Once per banner, whatever re-renders the frame: the key names the person,
  // workspace, month and threshold.
  useEffect(() => {
    if (!dismissKey || !metric || !threshold) return;
    const dismissed = remembered(dismissKey);
    setHidden(dismissed);
    if (!dismissed) track("usage_banner_shown", { metric, threshold });
  }, [dismissKey, metric, threshold]);

  if (!state || hidden) return null;

  function dismiss() {
    if (!state) return;
    remember(state.dismissKey);
    setHidden(true);
    track("usage_banner_dismissed", {
      metric: state.metric,
      threshold: state.threshold,
    });
  }

  return (
    <div
      data-slot="usage-banner"
      data-tone={state.tone}
      role={state.tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-center gap-3 border-b px-8 py-2 text-ui leading-snug phone:px-4",
        toneLooks[state.tone].soft,
        toneLooks[state.tone].border,
      )}
    >
      <p className="min-w-0 flex-1">{state.message}</p>
      {state.action ? (
        <TextLink
          href={state.action.href}
          variant="inherit"
          className="shrink-0"
        >
          {state.action.label}
        </TextLink>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this notice"
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-sm opacity-70 hover:opacity-100",
          focusRing,
        )}
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
