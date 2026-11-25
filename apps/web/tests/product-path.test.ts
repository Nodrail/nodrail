import { afterEach, describe, expect, test, vi } from "vitest";
import { appRoute, isProductPath, productPath } from "@/lib/product-path";

describe("product paths with one host (local, e2e, previews)", () => {
  test.each([
    ["", "/app"],
    ["new", "/app/new"],
    ["acme", "/app/acme"],
    ["acme/development/activity", "/app/acme/development/activity"],
    ["login/development", "/app/login/development"],
  ])("%j is %s", (path, expected) =>
    expect(productPath(path, false)).toBe(expected),
  );
});

describe("product paths on their own host", () => {
  test.each([
    ["", "/"],
    ["new", "/new"],
    ["acme", "/acme"],
    ["acme/development/activity", "/acme/development/activity"],
    [
      "acme/development/activity?view=runs",
      "/acme/development/activity?view=runs",
    ],
    ["acme/export", "/acme/export"],
  ])("%j is %s", (path, expected) =>
    expect(productPath(path, true)).toBe(expected),
  );

  test.each(["login", "api", "app", "docs", "invite", "es"])(
    "a workspace older than the reserved slug %s keeps /app",
    (slug) =>
      expect(productPath(`${slug}/development`, true)).toBe(
        `/app/${slug}/development`,
      ),
  );
});

describe("appPath reads the build flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function load(flag: string | undefined) {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SHORT_PRODUCT_URLS", flag);
    return import("@/lib/product-path");
  }

  test("short when the flag is true", async () => {
    const { appPath } = await load("true");
    expect(appPath()).toBe("/");
    expect(appPath("acme", "development", "policies/new?from=a1")).toBe(
      "/acme/development/policies/new?from=a1",
    );
  });

  test.each([undefined, "false", ""])(
    "with /app when the flag is %j",
    async (flag) => {
      const { appPath } = await load(flag);
      expect(appPath()).toBe("/app");
      expect(appPath("acme", "development", "overview")).toBe(
        "/app/acme/development/overview",
      );
      expect(appPath("new")).toBe("/app/new");
    },
  );

  test("route files are always under /app, for revalidatePath", async () => {
    const { appRoute: route } = await load("true");
    expect(route("acme")).toBe("/app/acme");
  });
});

describe("which paths open the product", () => {
  test.each(["/app", "/app/acme", "/app/acme/development/agents"])(
    "%s does in both modes",
    (path) => {
      expect(isProductPath(path, false)).toBe(true);
      expect(isProductPath(path, true)).toBe(true);
    },
  );

  test.each(["/", "/acme", "/acme/development/agents", "/new"])(
    "%s does only with short URLs",
    (path) => {
      expect(isProductPath(path, false)).toBe(false);
      expect(isProductPath(path, true)).toBe(true);
    },
  );

  test.each([
    "/login",
    "/signup",
    "/invite/x",
    "/docs",
    "/api/v1",
    "/applications",
  ])("%s is not a product page with /app", (path) =>
    expect(isProductPath(path, false)).toBe(false),
  );

  test.each([
    "/login",
    "/signup",
    "/invite/x",
    "/docs",
    "/api/v1",
    "/robots.txt",
  ])("%s is not a short product page", (path) =>
    expect(isProductPath(path, true)).toBe(false),
  );

  test("appRoute never drops the prefix", () => {
    expect(appRoute()).toBe("/app");
    expect(appRoute("acme", "development")).toBe("/app/acme/development");
  });
});
