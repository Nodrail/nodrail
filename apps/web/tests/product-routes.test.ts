import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  appTopLevel,
  isReservedEnvironmentSlug,
  isReservedWorkspaceSlug,
  isShortProductSegment,
  productTopLevel,
  reservedWorkspaceSlugs,
  sharedTopLevel,
  siteTopLevel,
  workspaceTopLevel,
} from "@nodrail/web-shared/routes";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = join(here, "../src/app");
/** The website's routes (apps/site), which the app host sends there. */
const siteDir = join(here, "../../site/src/app");
const workspace = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
);

/** Route segments of a directory: folders, through route groups `(name)`. */
function segments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    if (/^\(.+\)$/.test(entry.name)) return segments(join(dir, entry.name));
    return [entry.name];
  });
}

/** Folders such as `llms.txt` or `.well-known` are files, never a slug. */
const pages = (names: string[]) => names.filter((name) => !name.includes("."));

/** Root files that become routes, such as robots.ts → /robots.txt. */
const rootFiles = (dir: string) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

// The standalone server checks the public route list against its own files.
// In a checkout with the website, verify the website files against it too.
const siteSegments = () =>
  workspace.name === "nodrail-server" ? [...siteTopLevel] : segments(siteDir);
const siteRootFiles = () =>
  workspace.name === "nodrail-server" ? [] : rootFiles(siteDir);
const allSegments = () => [...segments(appDir), ...siteSegments()];

describe("the top-level routes the app host must not rewrite", () => {
  test("every top-level folder of both apps' src/app is listed", () => {
    const listed = new Set<string>([
      ...productTopLevel,
      ...siteTopLevel,
      ...sharedTopLevel,
      "app",
    ]);
    const all = allSegments();
    expect(pages(all).filter((name) => !listed.has(name))).toEqual([]);
    for (const name of all.filter((item) => item.includes(".")))
      expect(isShortProductSegment(name)).toBe(false);
  });

  test("the product's own routes and the site's are listed apart", () => {
    const product = segments(join(appDir, "(product)"));
    expect([...product].sort()).toEqual([...productTopLevel, "app"].sort());
    for (const name of pages(siteSegments()))
      expect(siteTopLevel).toContain(name);
    for (const name of segments(appDir))
      expect(siteTopLevel).not.toContain(name);
  });

  test("every folder inside /app that isn't a workspace is listed", () => {
    const inside = segments(join(appDir, "(product)/app")).filter(
      (name) => !name.startsWith("["),
    );
    expect(inside.sort()).toEqual([...appTopLevel].sort());
  });

  test("every folder inside a workspace that isn't an environment is listed", () => {
    const inside = segments(join(appDir, "(product)/app/[workspace]")).filter(
      (name) => !name.startsWith("["),
    );
    expect(inside.sort()).toEqual([...workspaceTopLevel].sort());
  });

  test("root files are served as files, not workspaces", () => {
    const routes = [...rootFiles(appDir), ...siteRootFiles()]
      .filter((name) => !/^(layout|page|global-not-found)\./.test(name))
      .map((name) => name.replace(/\.(ts|tsx)$/, ""));
    for (const name of routes) {
      const served = name.includes(".") ? name : `${name}.txt`;
      expect(isShortProductSegment(served)).toBe(false);
    }
  });
});

describe("reserved workspace slugs", () => {
  test.each([
    "login",
    "signup",
    "logout",
    "auth",
    "api",
    "app",
    "invite",
    "invites",
    "new",
    "settings",
    "account",
    "admin",
    "help",
    "docs",
    "static",
    "_next",
    "assets",
    "billing",
    "status",
    "health",
    "www",
    "pricing",
    "es",
  ])("%s is reserved", (slug) =>
    expect(isReservedWorkspaceSlug(slug)).toBe(true),
  );

  test("every top-level route is reserved", () => {
    for (const name of pages(allSegments()))
      expect(reservedWorkspaceSlugs.has(name)).toBe(true);
    for (const name of appTopLevel)
      expect(reservedWorkspaceSlugs.has(name)).toBe(true);
  });

  test.each(["acme-studio", "applications", "login-a1b2c3", "workspace"])(
    "%s is a usable slug",
    (slug) => expect(isReservedWorkspaceSlug(slug)).toBe(false),
  );
});

describe("reserved environment slugs", () => {
  test.each(["settings", "account", "export"])("%s is reserved", (slug) =>
    expect(isReservedEnvironmentSlug(slug)).toBe(true),
  );

  test.each(["development", "production", "staging"])(
    "%s is a usable slug",
    (slug) => expect(isReservedEnvironmentSlug(slug)).toBe(false),
  );
});
