import type { PostHog, PostHogConfig } from "posthog-js";
import {
  isSignedOutRoute,
  scrubEvent,
  type AnalyticsSurface,
  type ProductEvent,
  type PublicPaths,
} from "./sanitize";

const POSTHOG_HOST = "https://us.i.posthog.com";
/** One choice for the marketing site and the product. */
export const CONSENT_KEY = "nodrail-analytics-consent";

export type ConsentChoice = "granted" | "denied";

/** Blocked storage counts as no choice, which means nothing is sent. */
export function readConsent(): ConsentChoice | null {
  try {
    const stored = window.localStorage.getItem(CONSENT_KEY);
    return stored === "granted" || stored === "denied" ? stored : null;
  } catch {
    return null;
  }
}

function posthogConfig(
  surface: AnalyticsSurface,
  publicPaths: PublicPaths,
): Partial<PostHogConfig> {
  const product = surface === "product";
  return {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    // Stays in this browser, and the origin never sees it on a request.
    persistence: "localStorage",
    disable_session_recording: true,
    // Sent by hand, so client navigations count and URLs are sanitized.
    capture_pageview: false,
    capture_pageleave: false,
    // Product pages display what agents do: no element data may leave them.
    autocapture: !product,
    mask_all_text: product,
    mask_all_element_attributes: product,
    capture_heatmaps: false,
    rageclick: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    // Flag requests carry identity and person properties around `before_send`.
    advanced_disable_flags: true,
    before_send: (event) =>
      readConsent() === "granted"
        ? scrubEvent(event, surface, window.location.origin, publicPaths)
        : null,
  };
}

let client: PostHog | null = null;
let starting: Promise<void> | null = null;
let identity: { userId: string; workspaceId: string } | null = null;
let lastPageview: string | null = null;

function applyIdentity() {
  if (!client || !identity) return;
  client.identify(identity.userId);
  client.group("workspace", identity.workspaceId);
}

/**
 * Nothing is loaded, and so nothing can reach PostHog, without consent. The
 * website passes its public pages, which keep their real path in events.
 */
export function startPosthog(
  surface: AnalyticsSurface,
  publicPaths: PublicPaths = new Set(),
): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || readConsent() !== "granted") return Promise.resolve();
  starting ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(key, posthogConfig(surface, publicPaths));
    client = posthog;
    applyIdentity();
  });
  return starting;
}

/** Remembered until PostHog is loaded, since consent can come after sign-in. */
export function setAnalyticsIdentity(userId: string, workspaceId: string) {
  identity = { userId, workspaceId };
  applyIdentity();
}

/** Leaving a workspace: later events must not be counted against it. */
export function clearAnalyticsWorkspace() {
  identity = null;
  client?.resetGroups();
}

/** Keyed on the real path, so each agent's page counts as its own view. */
export function capturePageview() {
  if (!client) return;
  const { pathname } = window.location;
  if (pathname === lastPageview) return;
  lastPageview = pathname;
  if (
    isSignedOutRoute(pathname) &&
    client.get_property("$user_state") === "identified"
  )
    client.reset();
  client.capture("$pageview");
}

/** A named event; the console types its properties (`track`). */
export function captureEvent(
  event: ProductEvent,
  properties?: Parameters<PostHog["capture"]>[1],
) {
  client?.capture(event, properties);
}

/** After a withdrawal, what PostHog kept in this browser goes too. */
export function forgetPosthogData() {
  for (const storage of [window.localStorage, window.sessionStorage])
    Object.keys(storage)
      .filter((key) => /^(__)?ph_/.test(key))
      .forEach((key) => storage.removeItem(key));
}
