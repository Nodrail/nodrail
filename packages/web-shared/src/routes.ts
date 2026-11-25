/**
 * The first path segments the app answers itself, so on the app host they can
 * never be a workspace. `apps/web/tests/product-routes.test.ts` checks these
 * lists against both apps' `src/app`, so a new top-level route fails a test
 * until it is added.
 */

/**
 * Set at build time by apps/web/next.config.ts: true when the product has its
 * own host (APP_HOST), where `/app` is dropped from its URLs. The value is
 * inlined, so the server render and the browser always agree. The website
 * never sets it.
 */
export const shortProductUrls =
  process.env.NEXT_PUBLIC_SHORT_PRODUCT_URLS === "true";

/** Top-level routes of `app/(product)` outside `/app`. */
export const productTopLevel = ["login", "signup", "auth", "invite"] as const;

/** Routes inside `/app` that are not a workspace. */
export const appTopLevel = ["new"] as const;

/**
 * Routes inside a workspace that are not an environment: `/<workspace>/settings`
 * opens the workspace's settings, so no environment may be called that.
 */
export const workspaceTopLevel = ["settings", "account", "export"] as const;

/**
 * Top-level routes of the public site (apps/site): `app/(marketing)`, root
 * routes, legacy `/es`. The app host sends them to the site.
 */
export const siteTopLevel = [
  "about",
  "docs",
  "docs-markdown",
  "es",
  "features",
  "guides",
  "integrations",
  "open-source",
  "pricing",
  "privacy",
] as const;

/** Served from either host, never a page. */
export const sharedTopLevel = ["api", "_next"] as const;

/**
 * Never a workspace slug: every route above, the `/app` prefix itself, and
 * names likely to become routes. New workspaces skip these.
 */
export const reservedWorkspaceSlugs: ReadonlySet<string> = new Set([
  ...productTopLevel,
  ...appTopLevel,
  ...siteTopLevel,
  ...sharedTopLevel,
  "app",
  "logout",
  "invites",
  "settings",
  "account",
  "admin",
  "help",
  "static",
  "assets",
  "billing",
  "status",
  "health",
  "www",
]);

const servedAsIs: ReadonlySet<string> = new Set<string>([
  ...productTopLevel,
  ...siteTopLevel,
  ...sharedTopLevel,
  "app",
]);

/**
 * Whether `/<segment>/…` on the app host is a short product URL, rewritten to
 * `/app/<segment>/…`. False for routes the app serves under that name and for
 * files such as `/favicon.ico`.
 */
export function isShortProductSegment(segment: string) {
  return segment !== "" && !servedAsIs.has(segment) && !segment.includes(".");
}

const firstSegment = (pathname: string) => pathname.split("/", 2)[1] ?? "";

/**
 * The URL a product path has on the app host: `/app/<rest>` loses its prefix
 * unless `/<rest>` would open another route (a workspace whose slug predates
 * the reserved list). Anything else is returned as it is.
 */
export function shortPath(pathname: string) {
  if (pathname === "/app" || pathname === "/app/") return "/";
  if (!pathname.startsWith("/app/")) return pathname;
  const rest = pathname.slice("/app".length);
  return isShortProductSegment(firstSegment(rest)) ? rest : pathname;
}

export function isReservedWorkspaceSlug(slug: string) {
  return reservedWorkspaceSlugs.has(slug);
}

/** The last check before a workspace slug is stored. */
export function assertWorkspaceSlug(slug: string) {
  if (isReservedWorkspaceSlug(slug))
    throw new Error(
      `"${slug}" is reserved for a route of the app and can't be a workspace slug`,
    );
}

const reservedEnvironmentSlugs: ReadonlySet<string> = new Set(
  workspaceTopLevel,
);

export function isReservedEnvironmentSlug(slug: string) {
  return reservedEnvironmentSlugs.has(slug);
}

/** The last check before an environment slug is stored. */
export function assertEnvironmentSlug(slug: string) {
  if (isReservedEnvironmentSlug(slug))
    throw new Error(
      `"${slug}" is a page of every workspace and can't be an environment slug`,
    );
}
