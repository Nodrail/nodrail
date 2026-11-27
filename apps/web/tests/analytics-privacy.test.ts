import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CaptureResult } from "posthog-js";
import {
  productRoutes,
  routePattern,
  scrubEvent,
  unknownRoute,
} from "@nodrail/web-shared/analytics/sanitize";
import nextConfig from "../next.config";

const origin = "https://nodrail.test";
const productDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/app/(product)",
);

function event(
  name: string,
  properties: Record<string, unknown>,
  extra: Partial<CaptureResult> = {},
) {
  return { uuid: "u", event: name, properties, ...extra } as CaptureResult;
}

describe("route patterns", () => {
  test("long runs of separators preserve the route within the timing budget", () => {
    const separators = "/".repeat(80_000);
    const started = performance.now();
    const middle = routePattern(`/invite${separators}abc123`);
    const trailing = routePattern(`/invite/abc123${separators}`);
    expect(performance.now() - started).toBeLessThan(100);
    expect([middle, trailing]).toEqual(["/invite/[token]", "/invite/[token]"]);
  });

  test.each([
    ["/invite/abc123", "/invite/[token]"],
    ["/invite/abc123/", "/invite/[token]"],
    ["/app", "/app"],
    ["/app/new", "/app/new"],
    ["/app/acme", "/app/[workspace]"],
    [
      "/app/acme/prod/agents/support-agent",
      "/app/[workspace]/[environment]/agents/[agent]",
    ],
    [
      "/app/acme/prod/agents/connect",
      "/app/[workspace]/[environment]/agents/connect",
    ],
    ["/app/acme/settings/members", "/app/[workspace]/settings/members"],
    ["/app/acme/account/tokens", "/app/[workspace]/account/tokens"],
    [
      "/app/acme/prod/activity/evt_1",
      "/app/[workspace]/[environment]/activity/[event]",
    ],
    [
      "/app/acme/prod/activity/runs/run_1",
      "/app/[workspace]/[environment]/activity/runs/[run]",
    ],
    [
      "/app/acme/prod/policies/rule_1/edit",
      "/app/[workspace]/[environment]/policies/[rule]/edit",
    ],
    [
      "/app/acme/prod/policies/new",
      "/app/[workspace]/[environment]/policies/new",
    ],
    ["/app/acme/prod/wat", "/app/[workspace]/[environment]/[section]"],
    ["/auth/confirm", "/auth/confirm"],
    ["/app/acme/prod/agents/a/b/c", unknownRoute],
    ["/some/unknown/path", unknownRoute],
  ])("%s becomes %s", (path, route) => {
    assert.equal(routePattern(path), route);
  });

  test.each([
    ["/", "/app"],
    ["/acme", "/app/[workspace]"],
    ["/new", "/app/new"],
    [
      "/acme/prod/agents/support-agent",
      "/app/[workspace]/[environment]/agents/[agent]",
    ],
    ["/app/acme/prod/agents", "/app/[workspace]/[environment]/agents"],
    ["/login", "/login"],
    // The website's pages are not the console's: the app host moves them.
    ["/pricing", unknownRoute],
    ["/docs/unknown/page", unknownRoute],
  ])("with short product URLs %s becomes %s", (path, route) => {
    assert.equal(routePattern(path, true), route);
  });

  test("public pages the website passes keep their real path", () => {
    const site = new Set(["/", "/privacy", "/guides/headless-ai-governance"]);
    assert.equal(routePattern("/", false, site), "/");
    assert.equal(routePattern("/privacy", true, site), "/privacy");
    assert.equal(
      routePattern("/guides/headless-ai-governance", false, site),
      "/guides/headless-ai-governance",
    );
    assert.equal(routePattern("/privacy"), unknownRoute);
  });

  test("every product page has a pattern", () => {
    const pages = readdirSync(productDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(`${sep}page.tsx`))
      .map((file) =>
        relative(".", dirname(file))
          .split(sep)
          // A route group, such as (index), is not part of the address.
          .filter((segment) => !/^\(.+\)$/.test(segment))
          .join("/"),
      )
      .map((path) => `/${path}`);
    assert.ok(pages.length > 20);
    for (const page of pages)
      assert.ok(
        (productRoutes as readonly string[]).includes(page),
        `${page} needs a route pattern`,
      );
  });
});

describe("scrubEvent", () => {
  const secret = "SECRET-token";

  test("nothing in a captured event keeps a sensitive URL", () => {
    const url = `${origin}/invite/${secret}?token_hash=${secret}#${secret}`;
    const clean = scrubEvent(
      event(
        "$pageview",
        {
          $current_url: url,
          $pathname: `/invite/${secret}`,
          $referrer: `${origin}/app/acme/prod/agents/${secret}`,
          $initial_current_url: url,
          $session_entry_url: url,
          $prev_pageview_pathname: `/app/acme/prod/agents/${secret}`,
          nested: { list: [url] },
          title: `Agent ${secret}`,
        },
        {
          $set: { $current_url: url },
          $set_once: { $initial_referrer: url, $initial_pathname: url },
        },
      ),
      "product",
      origin,
    );
    assert.ok(clean);
    assert.ok(!JSON.stringify(clean).includes(secret));
    expect(clean.properties.$current_url).toBe(`${origin}/invite/[token]`);
    expect(clean.properties.$pathname).toBe("/invite/[token]");
    expect(clean.properties.title).toBeUndefined();
  });

  test("other sites are reduced to their origin; $direct is kept", () => {
    const clean = scrubEvent(
      event("$pageview", {
        $referrer: "https://search.example/q?term=secret",
        $initial_referrer: "$direct",
      }),
      "marketing",
      origin,
    );
    expect(clean?.properties.$referrer).toBe("https://search.example/");
    expect(clean?.properties.$initial_referrer).toBe("$direct");
  });

  test.each([
    "$autocapture",
    "$rageclick",
    "$dead_click",
    "$exception",
    "$web_vitals",
    "$$heatmap",
    "$snapshot",
    "$feature_flag_called",
    "$set",
    "something_new",
  ])("%s is dropped on the product", (name) => {
    assert.equal(scrubEvent(event(name, {}), "product", origin), null);
  });

  test("autocapture is only kept on the marketing site", () => {
    assert.ok(scrubEvent(event("$autocapture", {}), "marketing", origin));
    assert.equal(
      scrubEvent(event("$autocapture", {}), "product", origin),
      null,
    );
  });

  test("named events pass", () => {
    assert.ok(scrubEvent(event("rule_created", {}), "product", origin));
  });
});

describe("content security policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function policies() {
    vi.stubEnv("NODE_ENV", "production");
    const rules = await nextConfig(PHASE_DEVELOPMENT_SERVER).headers!();
    return rules.flatMap((rule) =>
      rule.headers
        .filter((item) => item.key === "Content-Security-Policy")
        .map((item) => ({ source: rule.source, value: item.value })),
    );
  }

  test("without a PostHog key, analytics origins are absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const [{ value }] = await policies();
    expect(value).not.toMatch(/posthog|googletagmanager|cloudflare/);
  });

  test("one policy for every page: PostHog, never Google or Turnstile", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    const all = await policies();
    expect(all.map((rule) => rule.source)).toEqual(["/:path*"]);
    const [{ value }] = all;
    expect(value).toMatch(/script-src[^;]*us-assets\.i\.posthog\.com/);
    expect(value).toMatch(
      /connect-src 'self' https:\/\/us\.i\.posthog\.com https:\/\/us-assets\.i\.posthog\.com/,
    );
    expect(value).not.toMatch(/googletagmanager|google-analytics/);
    expect(value).not.toContain("challenges.cloudflare.com");
  });
});
