import type { CaptureResult } from "posthog-js";
import { isShortProductSegment, shortProductUrls } from "../routes";

export type AnalyticsSurface = "marketing" | "product";

/** The only named events that may ever leave for PostHog. */
export const productEvents = [
  "sign_in_requested",
  "workspace_created",
  "agent_connected",
  "rule_created",
  "rule_updated",
  "rule_revoked",
  "gate_created",
  "gate_updated",
  "gate_removed",
  "budget_created",
  "budget_updated",
  "budget_removed",
  "yaml_imported",
  "yaml_exported",
  "yaml_edited",
  "starter_pack_chosen",
  "checkout_started",
  "teammate_invited",
  "activity_exported",
  "tour_started",
  "tour_completed",
  "tour_skipped",
  "checklist_item_done",
  "whats_new_opened",
  "usage_banner_shown",
  "usage_banner_dismissed",
  "upgrade_recommendation_shown",
] as const;

export type ProductEvent = (typeof productEvents)[number];

const allowedEvents = new Set<string>([
  "$pageview",
  "$identify",
  "$groupidentify",
  ...productEvents,
]);

/**
 * The site's public pages, which keep their real path. The website passes its
 * list (`sitePaths` in apps/site); the console has none of its own.
 */
export type PublicPaths = ReadonlySet<string>;
const noPublicPaths: PublicPaths = new Set();

/**
 * Every product route under `app/(product)`, literal routes before the dynamic
 * siblings that would also match them. A path that matches nothing is reported
 * as `unknownRoute`, so a new route can never send its raw URL.
 */
export const productRoutes = [
  "/login",
  "/signup",
  "/auth/confirm",
  "/auth/[method]",
  "/invite/[token]",
  "/app",
  "/app/new",
  "/app/[workspace]",
  "/app/[workspace]/export",
  "/app/[workspace]/settings",
  "/app/[workspace]/settings/general",
  "/app/[workspace]/settings/members",
  "/app/[workspace]/settings/billing",
  "/app/[workspace]/settings/data",
  "/app/[workspace]/account",
  "/app/[workspace]/account/notifications",
  "/app/[workspace]/account/tokens",
  "/app/[workspace]/account/privacy",
  "/app/[workspace]/[environment]/overview",
  "/app/[workspace]/[environment]/activity",
  "/app/[workspace]/[environment]/activity/export",
  "/app/[workspace]/[environment]/activity/runs",
  "/app/[workspace]/[environment]/activity/runs/[run]",
  "/app/[workspace]/[environment]/activity/[event]",
  "/app/[workspace]/[environment]/agents",
  "/app/[workspace]/[environment]/agents/connect",
  "/app/[workspace]/[environment]/agents/[agent]",
  "/app/[workspace]/[environment]/agents/[agent]/rules",
  "/app/[workspace]/[environment]/agents/[agent]/runs",
  "/app/[workspace]/[environment]/agents/[agent]/settings",
  "/app/[workspace]/[environment]/insights",
  "/app/[workspace]/[environment]/inventory",
  "/app/[workspace]/[environment]/policies",
  "/app/[workspace]/[environment]/policies/new",
  "/app/[workspace]/[environment]/policies/import",
  "/app/[workspace]/[environment]/policies/export",
  "/app/[workspace]/[environment]/policies/yaml",
  "/app/[workspace]/[environment]/policies/gates",
  "/app/[workspace]/[environment]/policies/gates/new",
  "/app/[workspace]/[environment]/policies/gates/[entry]/edit",
  "/app/[workspace]/[environment]/policies/budgets",
  "/app/[workspace]/[environment]/policies/budgets/new",
  "/app/[workspace]/[environment]/policies/budgets/[entry]/edit",
  "/app/[workspace]/[environment]/policies/[rule]",
  "/app/[workspace]/[environment]/policies/[rule]/edit",
  "/app/[workspace]/[environment]/runs",
  "/app/[workspace]/[environment]/runs/reports",
  "/app/[workspace]/[environment]/runs/[run]",
  "/app/[workspace]/[environment]/[section]",
] as const;

export const unknownRoute = "/[unknown]";

const parts = (path: string) => path.split("/").filter(Boolean);

function matches(route: string, segments: string[]) {
  const pattern = parts(route);
  return (
    pattern.length === segments.length &&
    pattern.every(
      (part, index) => part.startsWith("[") || part === segments[index],
    )
  );
}

/** Public marketing paths stay as they are; everything else becomes its route. */
export function routePattern(
  pathname: string,
  short: boolean = shortProductUrls,
  publicPaths: PublicPaths = noPublicPaths,
): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (publicPaths.has(path)) return path;
  const segments = parts(path);
  // With short product URLs `/acme/prod/agents` is `/app/acme/prod/agents`,
  // and `/` the product home.
  const [first = ""] = segments;
  const inApp = short && (path === "/" || isShortProductSegment(first));
  const route = inApp ? ["app", ...segments] : segments;
  return productRoutes.find((item) => matches(item, route)) ?? unknownRoute;
}

/** Pages only someone signed out can see, because the server redirects others. */
export function isSignedOutRoute(pathname: string) {
  const route = routePattern(pathname);
  return route === "/login" || route === "/signup";
}

/** Where an event was captured: the page's origin and its public paths. */
type Place = { origin: string; publicPaths: PublicPaths };

function sanitizeLocation(value: string, { origin, publicPaths }: Place) {
  if (!value || value.startsWith("$")) return value;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return unknownRoute;
  }
  if (url.origin !== origin) return `${url.origin}/`;
  const route = routePattern(url.pathname, shortProductUrls, publicPaths);
  return value.startsWith("/") ? route : `${origin}${route}`;
}

const locationKey = /(url|referrer|pathname)$/i;
const locationValue = /^(\/|https?:)/i;

function scrub(value: unknown, key: string, place: Place): unknown {
  if (typeof value === "string")
    return locationKey.test(key) || locationValue.test(value)
      ? sanitizeLocation(value, place)
      : value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, key, place));
  if (value && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        scrub(item, name, place),
      ]),
    );
  return value;
}

/**
 * The last check before anything leaves the browser: unlisted events are
 * dropped, so a new SDK feature fails closed, and every URL in what remains
 * is reduced to its route. The page title can name an agent or a rule.
 */
export function scrubEvent(
  event: CaptureResult | null,
  surface: AnalyticsSurface,
  origin: string,
  publicPaths: PublicPaths = noPublicPaths,
): CaptureResult | null {
  if (!event) return null;
  const allowed =
    allowedEvents.has(event.event) ||
    (surface === "marketing" && event.event === "$autocapture");
  if (!allowed) return null;
  const place = { origin, publicPaths };
  const properties = scrub(event.properties, "", place) as Record<
    string,
    unknown
  >;
  delete properties.title;
  return {
    ...event,
    properties,
    ...(event.$set
      ? { $set: scrub(event.$set, "", place) as typeof event.$set }
      : {}),
    ...(event.$set_once
      ? {
          $set_once: scrub(
            event.$set_once,
            "",
            place,
          ) as typeof event.$set_once,
        }
      : {}),
  };
}
