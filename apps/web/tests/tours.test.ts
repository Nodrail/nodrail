import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { tourKeys } from "../src/contracts/v1/guidance";
import {
  tourForPath,
  tourForSection,
  tours,
} from "../src/features/guidance/tours";

const src = new URL("../src/", import.meta.url).pathname;

/** Every component's source, to look for the anchors the tours point at. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")
      ? [readFileSync(path, "utf8")]
      : [];
  });
}

const workspaceRoutes = new URL(
  "../src/app/(product)/app/[workspace]/",
  import.meta.url,
).pathname;

/** Every page below a workspace, as a path with sample values. */
function workspacePages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return workspacePages(path);
    if (entry.name !== "page.tsx") return [];
    const segments = relative(workspaceRoutes, dir)
      .split("/")
      .filter((segment) => segment && !/^\(.*\)$/.test(segment))
      .map((segment) =>
        segment === "[environment]"
          ? "development"
          : segment.replace(/^\[(\w+)\]$/, "sample-$1"),
      );
    return [`/${segments.join("/")}`];
  });
}

/**
 * Pages that only send the person elsewhere, so they never show a screen of
 * their own. Anything else below a workspace needs a tour.
 */
const redirectsOnly = new Set([
  "/", // to the default environment
  "/development/sample-section", // unknown sections and old names
  "/development/runs", // runs moved into Activity
  "/development/runs/reports",
  "/development/runs/sample-run",
  "/development/activity/runs", // the runs view of Activity
  "/development/activity/sample-event", // the event opens over Activity
]);

describe("tours", () => {
  const code = sources(src).join("\n");
  // Anchors built from a template, such as `policies-tab-${value}`.
  const prefixes = [...code.matchAll(/`([a-z-]+-)\$\{/g)].map(
    ([, prefix]) => prefix,
  );

  test.each(tourKeys)("%s has three to five steps", (key) => {
    expect(tours[key].steps.length).toBeGreaterThanOrEqual(3);
    expect(tours[key].steps.length).toBeLessThanOrEqual(5);
  });

  test.each(
    tourKeys.flatMap((key) => tours[key].steps.map((step) => step.anchor)),
  )("the anchor %s is on a page", (anchor) => {
    // As `data-tour="…"`, the `tour` prop of a component that sets it, or
    // the `tour` field of a list a menu is drawn from.
    const literal =
      code.includes(`tour="${anchor}"`) || code.includes(`tour: "${anchor}"`);
    const built = prefixes.some((prefix) => anchor.startsWith(prefix));
    expect(literal || built).toBe(true);
  });

  test.each([
    ["/approvals", null],
    ["/policies", "policies"],
    ["/policies/gates", "policies"],
    ["/policies/budgets", "policies"],
    ["/policies/budgets/new", "run-policy"],
    ["/policies/yaml", "policies-yaml"],
    ["/policies/new", "rule"],
    ["/policies/8f0c2f1e-3a4b-4c5d-8e9f-0a1b2c3d4e5f", "rule"],
    ["/policies/8f0c2f1e-3a4b-4c5d-8e9f-0a1b2c3d4e5f/edit", "rule"],
    ["/policies/import", "import"],
    ["/agents", "agents"],
    ["/agents/connect", "connect"],
    ["/agents/support", "agent"],
    ["/agents/support/rules", "agent"],
    ["/agents/support/runs", "agent"],
    ["/agents/support/settings", "agent"],
    ["/agents/support/other", null],
    ["/activity", "activity"],
    ["/insights", "insights"],
    ["/overview", "overview"],
    ["/activity/runs/run-1", "run"],
  ])("%s opens the %s tour", (path, key) => {
    expect(tourForSection(path)).toBe(key);
  });

  test.each([
    ["/settings/general", "settings"],
    ["/settings/members", "settings"],
    ["/account/tokens", "account"],
    ["/development/overview", "overview"],
    ["/development/agents/support/runs", "agent"],
  ])("below the workspace, %s opens the %s tour", (path, key) => {
    expect(tourForPath(path)).toBe(key);
  });

  test.each(workspacePages(workspaceRoutes))("the page %s", (path) => {
    if (redirectsOnly.has(path)) return;
    expect(tourForPath(path), `${path} has no tour`).not.toBeNull();
  });

  test("every page listed as a redirect still exists", () => {
    const pages = new Set(workspacePages(workspaceRoutes));
    for (const path of redirectsOnly) expect(pages).toContain(path);
  });
});
