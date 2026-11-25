"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CONSENT_KEY,
  capturePageview,
  forgetPosthogData,
  readConsent,
  startPosthog,
  type ConsentChoice,
} from "./posthog";
import type { AnalyticsSurface, PublicPaths } from "./sanitize";

const OPEN_EVENT = "nodrail:open-consent";

/**
 * Scripts a surface loads besides PostHog, under the same consent: the
 * website's tag manager (apps/site). The console has none. Pass a value that
 * stays the same between renders.
 */
export type ConsentedScripts = {
  /** Whether there is anything to load, so the banner has a reason to ask. */
  configured: () => boolean;
  load: () => void;
};

const analyticsConfigured = (scripts?: ConsentedScripts) =>
  Boolean(scripts?.configured() || process.env.NEXT_PUBLIC_POSTHOG_KEY);

let loaded = false;
const noPaths: readonly string[] = [];

/** Nothing reaches a third party before this runs. */
function loadAnalytics(
  surface: AnalyticsSurface,
  publicPaths: PublicPaths,
  scripts?: ConsentedScripts,
) {
  if (loaded) return;
  loaded = true;
  if (scripts?.configured()) scripts.load();
  void startPosthog(surface, publicPaths);
}

/**
 * Each surface styles its own buttons (`buttonClassName`): the product's
 * outline button, the website's small button. The website also passes its
 * public pages, which keep their real path in what PostHog receives, and its
 * tag manager (`scripts`).
 */
export function AnalyticsConsent({
  copy,
  privacyHref,
  buttonClassName,
  surface = "marketing",
  publicPaths: paths = noPaths,
  scripts,
}: {
  copy: { message: string; privacy: string; accept: string; reject: string };
  privacyHref: string;
  buttonClassName: string;
  surface?: AnalyticsSurface;
  publicPaths?: readonly string[];
  scripts?: ConsentedScripts;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const publicPaths = useMemo<PublicPaths>(() => new Set(paths), [paths]);

  useEffect(() => {
    if (!analyticsConfigured(scripts)) return;
    const choice = readConsent();
    if (choice === "granted") loadAnalytics(surface, publicPaths, scripts);
    else forgetPosthogData();
    if (choice === null) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, reopen);
    return () => window.removeEventListener(OPEN_EVENT, reopen);
  }, [surface, publicPaths, scripts]);

  useEffect(() => {
    if (pathname) void startPosthog(surface, publicPaths).then(capturePageview);
  }, [pathname, surface, publicPaths]);

  if (!open) return null;

  function choose(choice: ConsentChoice) {
    const wasGranted = readConsent() === "granted";
    window.localStorage.setItem(CONSENT_KEY, choice);
    setOpen(false);
    if (choice === "granted") {
      loadAnalytics(surface, publicPaths, scripts);
      if (pathname)
        void startPosthog(surface, publicPaths).then(capturePageview);
    }
    // Scripts already running can only be stopped by leaving the page.
    else if (wasGranted) window.location.reload();
  }

  return (
    <section className="consent-banner" aria-label={copy.privacy}>
      <p>
        {copy.message} <a href={privacyHref}>{copy.privacy}</a>
      </p>
      <div>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => choose("granted")}
        >
          {copy.accept}
        </button>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => choose("denied")}
        >
          {copy.reject}
        </button>
      </div>
    </section>
  );
}

/** Reopens the consent banner. Unstyled: the caller places it. */
export function ConsentSettingsButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
    >
      {label}
    </button>
  );
}
