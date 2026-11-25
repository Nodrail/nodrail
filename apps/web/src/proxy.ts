import { NextResponse, type NextRequest } from "next/server";
import { site } from "@nodrail/web-shared/site";
import { AUTH_RETURN_PATH_HEADER } from "@/features/auth/next-path";
import { deploymentMode } from "@/server/deployment";
import { routeRequest } from "@/lib/host-routing";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";

const NEEDS_SESSION = /^\/(?:app|invite)(?:\/|$)/;

/**
 * Sends the website's pages to the site and, on the app host, serves product
 * pages without `/app` in the URL (see `routeRequest`). The cookie check
 * preserves the destination for visitors who need to sign in. Pages and
 * actions resolve the actual session against Postgres.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const decision = routeRequest(
    { host: request.headers.get("host") ?? "", pathname, search },
    {
      appHost: process.env.APP_HOST,
      siteUrl: site.url,
      redirectSite: deploymentMode() === "cloud",
    },
  );
  if (decision.kind === "redirect")
    return NextResponse.redirect(
      new URL(decision.url, request.url),
      decision.status,
    );
  const route = decision.kind === "rewrite" ? decision.pathname : pathname;
  const target = request.nextUrl.clone();
  target.pathname = route;
  const headers = new Headers(request.headers);
  headers.delete(AUTH_RETURN_PATH_HEADER);
  const forward = () =>
    decision.kind === "rewrite"
      ? NextResponse.rewrite(target, { request: { headers } })
      : NextResponse.next({ request: { headers } });
  if (!NEEDS_SESSION.test(route)) return forward();

  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const login = new URL("/login", request.url);
    // The URL the person asked for, which on the app host has no `/app`.
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  // Server-side session checks use the original path if the cookie is stale.
  headers.set(AUTH_RETURN_PATH_HEADER, pathname);
  const response = forward();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)",
    // Files of the website, which move to it: `siteFiles` in host-routing.
    // Next.js reads this list as written, so it cannot import that one.
    "/docs/:slug.md",
    "/docs.md",
    "/llms.txt",
    "/llms-full.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/security.txt",
  ],
};
