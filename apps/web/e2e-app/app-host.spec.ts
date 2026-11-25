import { expect, test } from "@playwright/test";
import { appHost } from "./hosts";
import { startWorkspace } from "./helpers";

/**
 * The server is told the product has its own host, but these tests reach it at
 * 127.0.0.1, which is not that host, so every other spec keeps `/app`. Asking
 * with the app host's name shows what app.nodrail.com does.
 */
const asAppHost = { headers: { host: appHost }, maxRedirects: 0 };

test.describe("short product URLs on the app host", () => {
  test("a workspace page opens without /app, and old links move there", async ({
    page,
  }) => {
    const { slug } = await startWorkspace(page, `Short ${Date.now()}`);

    const short = await page.request.get(
      `/${slug}/development/activity`,
      asAppHost,
    );
    expect(short.status()).toBe(200);
    expect(await short.text()).toContain("Activity");

    const old = await page.request.get(
      `/app/${slug}/development/activity?outcome=denied`,
      asAppHost,
    );
    expect(old.status()).toBe(308);
    expect(new URL(old.headers().location ?? "", "http://x").pathname).toBe(
      `/${slug}/development/activity`,
    );
    expect(old.headers().location).toContain("?outcome=denied");

    const settings = await page.request.get(
      `/${slug}/settings/members`,
      asAppHost,
    );
    expect(settings.status()).toBe(200);
    expect(await settings.text()).toContain("Members");
  });

  test("signed out, a short URL asks to sign in and comes back to it", async ({
    request,
  }) => {
    const response = await request.get("/acme/development/overview", asAppHost);
    expect(response.status()).toBe(307);
    const location = new URL(response.headers().location ?? "", "http://x");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe(
      "/acme/development/overview",
    );
  });

  test("the product's own routes are not workspaces", async ({ request }) => {
    const login = await request.get("/login", asAppHost);
    expect(login.status()).toBe(200);
    const health = await request.get("/api/health", asAppHost);
    expect(health.ok()).toBe(true);
  });
});
