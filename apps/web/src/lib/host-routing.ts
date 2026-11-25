import {
  isShortProductSegment,
  shortPath,
  siteTopLevel,
} from "@nodrail/web-shared/routes";

export { shortPath };

/** Served as they are: APIs, build output and files such as the favicon. */
const SHARED_PATH = /^\/(?:api|_next)\/|\.[a-z0-9]+$/i;
const SITE_ROOTS: ReadonlySet<string> = new Set(siteTopLevel);
/**
 * The website's own files at the root (apps/site). The proxy is asked about
 * them by name, because its matcher skips paths that look like files.
 */
export const siteFiles = [
  "/docs.md",
  "/llms.txt",
  "/llms-full.txt",
  "/robots.txt",
  "/sitemap.xml",
  "/.well-known/security.txt",
] as const;
const SITE_FILES: ReadonlySet<string> = new Set(siteFiles);

export type Hosts = {
  /** The product's own host, where its URLs drop `/app`. */
  appHost?: string;
  /** The website's origin, such as https://nodrail.com. */
  siteUrl: string;
  redirectSite?: boolean;
};

export type RouteDecision =
  | { kind: "next" }
  | { kind: "redirect"; url: string; status: 307 | 308 }
  | { kind: "rewrite"; pathname: string };

type Request = { host: string; pathname: string; search: string };

const firstSegment = (pathname: string) => pathname.split("/", 2)[1] ?? "";

function onAppHost({ pathname, search }: Request): RouteDecision {
  if (pathname === "/") return { kind: "rewrite", pathname: "/app" };
  const short = shortPath(pathname);
  if (short !== pathname)
    return { kind: "redirect", url: `${short}${search}`, status: 308 };
  if (isShortProductSegment(firstSegment(pathname)))
    return { kind: "rewrite", pathname: `/app${pathname}` };
  return { kind: "next" };
}

const isSitePath = (pathname: string) =>
  SITE_ROOTS.has(firstSegment(pathname)) ||
  SITE_FILES.has(pathname) ||
  /^\/docs\/[^/]+\.md$/.test(pathname);

/**
 * What to do with a request to the server. The server is the product only:
 * the website (apps/site) serves nodrail.com, so its pages and files move
 * there, with their query. On the app host a product page drops `/app` from
 * its URL: `/<workspace>/…` is served from `/app/<workspace>/…` and old
 * `/app/…` links move there for good. Without an app host (local
 * development, previews, a self-hosted server on one host) product URLs keep
 * `/app`, and `/` opens the product home, which signs in whoever needs it.
 */
export function routeRequest(request: Request, hosts: Hosts): RouteDecision {
  const { appHost, siteUrl } = hosts;
  const hostname = request.host.split(":")[0]?.toLowerCase();
  const { pathname, search } = request;
  if (isSitePath(pathname)) {
    if (hosts.redirectSite === false) return { kind: "next" };
    // Never back to itself: while the site's domain still points here, its
    // pages are missing rather than redirected in a loop.
    const site = new URL(siteUrl).hostname;
    if (hostname === site || hostname === `www.${site}`)
      return { kind: "next" };
    return {
      kind: "redirect",
      url: `${siteUrl}${pathname}${search}`,
      status: 307,
    };
  }
  if (SHARED_PATH.test(pathname)) return { kind: "next" };
  if (appHost && hostname === appHost) return onAppHost(request);
  if (pathname === "/") return { kind: "redirect", url: "/app", status: 307 };
  return { kind: "next" };
}
