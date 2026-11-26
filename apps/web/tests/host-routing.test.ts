import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { routeRequest, shortPath, siteFiles } from "@/lib/host-routing";

const siteUrl = "https://nodrail.com";
const hosts = { appHost: "app.nodrail.com", siteUrl };
const on = (host: string, pathname: string, search = "") =>
  routeRequest({ host, pathname, search }, hosts);
const next = { kind: "next" };
const rewrite = (pathname: string) => ({ kind: "rewrite", pathname });
const redirect = (url: string, status: number) => ({
  kind: "redirect",
  url,
  status,
});

describe("the app host", () => {
  test("opens on the product home, which signs in whoever needs it", () => {
    expect(on("app.nodrail.com", "/")).toEqual(rewrite("/app"));
  });

  test.each([
    ["/acme-studio", "/app/acme-studio"],
    [
      "/acme-studio/development/activity",
      "/app/acme-studio/development/activity",
    ],
    [
      "/acme/production/policies/r1/edit",
      "/app/acme/production/policies/r1/edit",
    ],
    ["/acme/export", "/app/acme/export"],
    ["/new", "/app/new"],
    ["/applications", "/app/applications"],
  ])("serves %s from %s, keeping the short URL", (path, route) =>
    expect(on("app.nodrail.com", path)).toEqual(rewrite(route)),
  );

  test.each([
    ["/app", "", "/"],
    ["/app/", "", "/"],
    [
      "/app/acme/development/activity",
      "?status=open",
      "/acme/development/activity?status=open",
    ],
    ["/app/new", "", "/new"],
    ["/app/acme", "?a=1&b=2", "/acme?a=1&b=2"],
  ])("moves the old link %s%s to %s for good", (path, search, target) =>
    expect(on("app.nodrail.com", path, search)).toEqual(redirect(target, 308)),
  );

  test.each(["/login", "/signup", "/invite/x", "/auth/confirm"])(
    "%s is a product route of its own",
    (path) => expect(on("app.nodrail.com", path)).toEqual(next),
  );

  test.each([
    "/api/health",
    "/API/health",
    "/_NEXT/build",
    "/nested/favicon.ICO",
    "/api/webhooks/stripe",
    "/_next/static/a.js",
    "/favicon.ico",
    "/icon.svg",
  ])("%s is served as it is", (path) =>
    expect(on("app.nodrail.com", path)).toEqual(next),
  );

  test("a prefix inside the path and a suffix inside a segment are ordinary routes", () => {
    for (const path of ["/acme/api/health", "/acme/file.png/edit"])
      expect(on("app.nodrail.com", path)).toEqual(rewrite(`/app${path}`));
  });

  test.each(["/login", "/api", "/docs", "/app"])(
    "a workspace older than the reserved slug %s keeps its /app URL",
    (slug) => {
      const path = `/app${slug}/development/overview`;
      expect(on("app.nodrail.com", path)).toEqual(next);
      expect(shortPath(path)).toBe(path);
    },
  );

  test.each([
    ["/es/guides", "?a=1"],
    ["/pricing", ""],
    ["/docs/rules", ""],
    ["/privacy", ""],
    ["/docs/rules.md", ""],
    ["/llms.txt", ""],
    ["/robots.txt", ""],
    ["/.well-known/security.txt", ""],
  ])("site page %s goes to the site, keeping the query", (path, search) =>
    expect(on("app.nodrail.com", path, search)).toEqual(
      redirect(`https://nodrail.com${path}${search}`, 307),
    ),
  );

  test("the port and case of the host do not matter", () => {
    expect(on("APP.nodrail.com:443", "/acme")).toEqual(rewrite("/app/acme"));
  });
});

describe("the website's own host", () => {
  test.each(["nodrail.com", "www.nodrail.com", "NODRAIL.com:443"])(
    "site pages asked of %s are never sent back to it",
    (host) => expect(on(host, "/pricing")).toEqual(next),
  );
});

describe("one host", () => {
  test("other hosts, such as preview URLs, keep /app and open on the product", () => {
    expect(on("nodrail.vercel.app", "/login")).toEqual(next);
    expect(on("nodrail.vercel.app", "/app/acme")).toEqual(next);
    expect(on("nodrail.vercel.app", "/acme")).toEqual(next);
    expect(on("nodrail.vercel.app", "/")).toEqual(redirect("/app", 307));
  });

  test.each(["/app", "/app/acme/development/overview", "/acme", "/login"])(
    "with no app host nothing moves: %s",
    (pathname) =>
      expect(
        routeRequest(
          { host: "127.0.0.1:3100", pathname, search: "" },
          { siteUrl },
        ),
      ).toEqual(next),
  );

  test("with no app host / opens the product and site pages go to the site", () => {
    const local = (pathname: string) =>
      routeRequest(
        { host: "127.0.0.1:3100", pathname, search: "" },
        { siteUrl },
      );
    expect(local("/")).toEqual(redirect("/app", 307));
    expect(local("/docs/quickstart")).toEqual(
      redirect("https://nodrail.com/docs/quickstart", 307),
    );
  });
});

describe("the proxy", () => {
  test("is asked about every file of the website", () => {
    const proxy = readFileSync(
      new URL("../src/proxy.ts", import.meta.url),
      "utf8",
    );
    for (const file of siteFiles) expect(proxy).toContain(`"${file}"`);
  });
});

test.each(["/docs", "/pricing", "/docs/rules.md", "/llms.txt"])(
  "leaves %s unresolved in a product-only deployment",
  (pathname) => {
    expect(
      routeRequest(
        { host: "localhost", pathname, search: "" },
        { siteUrl, redirectSite: false },
      ),
    ).toEqual(next);
  },
);
