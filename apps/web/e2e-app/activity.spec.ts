import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import {
  addTeammate,
  assignAgent,
  connect,
  createRule,
  expectAccessible,
  openRowMenu,
  seedClientReport,
  seedDecision,
  startWorkspace,
  workspaceWithDecision as withRequest,
} from "./helpers";

const rows = (page: Page) => page.locator("[data-slot=data-table] tbody tr");
const panel = (page: Page) => page.getByRole("dialog");
const OPERATION = "github.issues.delete";
const eventUrl = /activity\?(.+&)?event=[0-9a-f-]{36}$/;

/** Opens the event in a row by its title, and waits for its panel. */
async function openEvent(page: Page, text: string) {
  await rows(page).filter({ hasText: text }).getByRole("link").first().click();
  await page.waitForURL(eventUrl);
  await expect(panel(page).getByText("Recorded by Nodrail")).toBeVisible();
}

/** Downloads an export from the menu and reads it as text. */
async function exportAs(page: Page, format: "CSV" | "JSON") {
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: new RegExp(`^${format}`) }).click(),
  ]);
  return { download, text: await readDownload(download) };
}

async function readDownload(download: Download) {
  return readFile(await download.path(), "utf8");
}

test.describe("activity", () => {
  test("a report of an action Nodrail never allowed is flagged", async ({
    page,
  }) => {
    const { base, slug } = await withRequest(page, "Mismatch");
    await seedClientReport(slug, "support", "success");
    await page.goto(`${base}/activity`);
    const row = rows(page).filter({ hasText: "Denied · no rule covers it" });
    await expect(row).toContainText("Client reported success");
    await expect(row).toContainText("Report doesn't match decision");
    await expectAccessible(page);

    await page.getByLabel("Event kind").selectOption("mismatches");
    await page.waitForURL(/kind=mismatches/);
    await expect(rows(page)).toHaveCount(1);
    await openEvent(page, OPERATION);
    await expect(
      panel(page).locator("[data-slot=report-mismatch]"),
    ).toContainText("Nodrail never allowed it");

    await page.goto(`${base}/overview`);
    const problems = page
      .locator("[data-slot=health-tile][data-tile=problems]")
      .filter({ visible: true });
    await problems
      .getByRole("link", { name: /^Report doesn't match decision/ })
      .click();
    await page.waitForURL(/activity\?kind=mismatches$/);
    await expect(rows(page)).toHaveCount(1);
  });

  test("a decision appears with what decided it", async ({ page }) => {
    const { base } = await withRequest(page, "Decided");
    await page.goto(`${base}/activity`);
    const row = rows(page).filter({ hasText: OPERATION });
    await expect(row).toContainText("Denied · no rule covers it");
    await expect(row).toContainText("Not reported");
    await expect(row).toContainText("support · support-dev · REQ-");
    await expectAccessible(page);

    await openEvent(page, OPERATION);
    await expect(
      panel(page).getByRole("heading", { name: OPERATION }),
    ).toBeVisible();
    await expect(panel(page).locator("[data-slot=inert-json]")).toContainText(
      '"issue": 482',
    );
    await expect(
      panel(page).getByText("No client report for this request."),
    ).toBeVisible();
    await expect(panel(page)).toContainText("No rule covers this call");
    await expect(
      panel(page).getByRole("link", { name: "View request" }),
    ).toHaveCount(0);
    await expectAccessible(page);
  });

  test("a client report stays apart from the decision and is inert", async ({
    page,
  }) => {
    const { base, slug } = await withRequest(page, "Report");
    const hostile = "<img src=x onerror=window.pwned=1>";
    await seedClientReport(slug, "support", "success", { note: hostile });
    await page.goto(`${base}/activity`);
    const row = rows(page).filter({ hasText: OPERATION });
    await expect(row).toContainText("Denied · no rule covers it");
    await expect(row).toContainText("Client reported success");

    await openEvent(page, OPERATION);
    await expect(
      panel(page).getByText("A report is not independent verification."),
    ).toBeVisible();
    await expect(panel(page).getByText("Names no permit")).toBeVisible();
    await expect(
      panel(page).locator("[data-slot=inert-json]").last(),
    ).toContainText(hostile);
    await expect(page.locator("[data-slot=inert-json] img")).toHaveCount(0);
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    await expectAccessible(page);
  });

  test("filters narrow the list and live in the URL", async ({ page }) => {
    const { base, slug } = await withRequest(page, "Filters");
    await createRule(page, base, {
      name: "Read issues",
      operation: "github.issues.list",
      resourceKind: "repository",
    });
    await seedClientReport(slug, "support", "failure");
    await page.goto(`${base}/activity`);
    await expect(rows(page)).toHaveCount(4);

    await page.getByLabel("Event kind").selectOption("changes");
    await page.waitForURL(/kind=changes/);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).first()).toContainText("Read issues");

    await page.getByLabel("Event kind").selectOption("reports");
    await page.waitForURL(/kind=reports/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Client reported failure");

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(rows(page)).toHaveCount(4);
    await expect(page).toHaveURL(/activity$/);

    await page.getByLabel("Outcome").selectOption("denied");
    await page.waitForURL(/outcome=denied/);
    await expect(rows(page)).toHaveCount(1);
    await page.reload();
    await expect(page.getByLabel("Outcome")).toHaveValue("denied");
    await expect(rows(page)).toHaveCount(1);

    // An old link to a kind of event still filters by it.
    await page.goto(`${base}/activity?view=changes`);
    await expect(page.getByLabel("Event kind")).toHaveValue("changes");
    await expect(rows(page)).toHaveCount(3);
  });

  test("agent, outcome and time range narrow the list", async ({ page }) => {
    const { base, slug } = await withRequest(page, "Shared filters");
    await connect(page, base, "billing");
    await seedDecision(slug, "billing", { resource: "acme/billing#7" });
    await page.goto(`${base}/activity`);

    await page.getByLabel("Agent").selectOption("billing");
    await page.waitForURL(/agent=billing/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText("acme/billing#7");

    await page.getByLabel("Outcome").selectOption("denied");
    await page.waitForURL(/outcome=denied&agent=billing/);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Denied · no rule covers it");

    await page.getByLabel("Time range").selectOption("24h");
    await page.waitForURL(/range=24h/);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator("[data-slot=list-pager]")).toHaveCount(0);

    await page.getByLabel("Outcome").selectOption("allowed");
    await expect(page.getByText("No events match these filters")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL(/activity$/);
    await expect(page.getByLabel("Agent")).toHaveValue("");
    await expect(rows(page)).toHaveCount(5);
  });

  test("search follows typing, and an empty result says so", async ({
    page,
  }) => {
    const { base } = await withRequest(page, "Search");
    await page.goto(`${base}/activity`);
    const search = page.getByLabel("Search activity");
    await search.fill("absent-thing");
    await search.press("Enter");
    await expect(page.getByText("No events match these filters")).toBeVisible();
    await expect(search).toHaveValue("absent-thing");
    await expectAccessible(page);

    await page.getByRole("button", { name: "Clear" }).click();
    await expect(search).toHaveValue("");
    // No button to press: the list follows once typing pauses.
    await search.fill("issues.delete");
    await expect(page).toHaveURL(/q=issues\.delete/);
    await expect(rows(page).filter({ hasText: OPERATION })).toHaveCount(1);
  });

  test("the agent page opens that agent's activity", async ({ page }) => {
    const { base } = await withRequest(page, "From agent");
    await page.goto(`${base}/agents/support`);
    await page.getByRole("link", { name: "View in Activity →" }).click();
    await page.waitForURL(/activity\?agent=support/);
    await expect(page.getByLabel("Agent")).toHaveValue("support");
    await expect(rows(page).filter({ hasText: OPERATION })).toHaveCount(1);
  });

  test("a row's ⋯ menu leads to its agent", async ({ page }) => {
    const { base } = await withRequest(page, "Event menu");
    await page.goto(`${base}/activity?range=24h`);
    const event = rows(page).filter({ hasText: OPERATION }).first();
    const menu = await openRowMenu(page, event);
    await expect(
      menu.getByRole("menuitem", { name: /create a rule|view request/i }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(eventUrl);
    await menu.getByRole("menuitem", { name: "Filter by this agent" }).click();
    await page.waitForURL(/activity\?.*agent=support/);
    await expect(page).toHaveURL(/range=24h/);
    await expect(page.getByLabel("Agent")).toHaveValue("support");
  });

  test("a new workspace starts with its own creation", async ({ page }) => {
    const { base } = await startWorkspace(page, `Quiet ${Date.now()}`);
    await page.goto(`${base}/activity`);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toContainText("Workspace created");
    await expectAccessible(page);
  });

  test("a damaged link is a page that does not exist", async ({ page }) => {
    const { base } = await startWorkspace(page, `Bad link ${Date.now()}`);
    const unknown = randomUUID();
    for (const path of [
      "activity?cursor=nope",
      "activity/not-an-event",
      `activity/${unknown}`,
      "activity?event=not-an-event",
      `activity?event=${unknown}`,
      "activity?run=nope",
      `activity?run=${unknown}`,
      `activity/runs/${unknown}`,
      `runs/${unknown}`,
    ]) {
      const response = await page.goto(`${base}/${path}`);
      expect(response?.status(), path).toBe(404);
    }
  });

  test("an unassigned viewer sees none of it", async ({ page, browser }) => {
    const { base, slug } = await withRequest(page, "Viewer");
    await page.goto(`${base}/activity`);
    const link = rows(page).filter({ hasText: OPERATION }).getByRole("link");
    const href = (await link.getAttribute("href")) ?? "";

    const viewer = await addTeammate(browser, slug, "viewer");
    await viewer.page.goto(`${base}/activity`);
    await expect(
      viewer.page.getByRole("heading", { name: "No activity yet" }),
    ).toBeVisible();
    expect((await viewer.page.goto(href))?.status()).toBe(404);

    await assignAgent(slug, "support", viewer.email);
    await viewer.page.goto(`${base}/activity`);
    await expect(
      rows(viewer.page).filter({ hasText: OPERATION }),
    ).toContainText("Denied · no rule covers it");
    await viewer.page.context().close();
  });

  test("works on a phone", async ({ page }) => {
    const { base } = await withRequest(page, "Phone");
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${base}/activity`);
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await openEvent(page, OPERATION);
      // The panel takes the whole screen.
      const box = await panel(page).boundingBox();
      expect(box?.width).toBeCloseTo(width, 0);
      await expect(
        panel(page).getByRole("heading", { name: OPERATION }),
      ).toBeVisible();
      await expectAccessible(page);
      await page.goto(`${base}/activity?view=runs`);
      await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
  });

  test("on a phone, the filters wait behind one button", async ({ page }) => {
    const { base } = await withRequest(page, "Phone filters");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/activity`);
    await expect(page.getByLabel("Outcome")).toHaveCount(0);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await sheet.getByLabel("Outcome").selectOption("denied");
    await page.waitForURL(/outcome=denied/);
    await expectAccessible(page);
    await sheet.getByRole("button", { name: "Show results" }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Filters (1)" }),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe("activity: the event panel", () => {
  test("opens by click, closes with Escape and with Back", async ({ page }) => {
    const { base } = await withRequest(page, "Panel");
    await page.goto(`${base}/activity?outcome=denied`);
    await openEvent(page, OPERATION);
    await expect(rows(page)).toHaveCount(1);

    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/activity\?outcome=denied$/);

    // A click anywhere on the row opens it too; Back closes it.
    await rows(page).first().getByText("acme/support#482").click();
    await page.waitForURL(eventUrl);
    await expect(panel(page)).toBeVisible();
    await page.goBack();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/activity\?outcome=denied$/);
    await expect(rows(page)).toHaveCount(1);
  });

  test("a link opens it, and the old address leads there", async ({ page }) => {
    const { base } = await withRequest(page, "Panel link");
    await page.goto(`${base}/activity`);
    await openEvent(page, OPERATION);
    const link = page.url();
    const id = new URL(link).searchParams.get("event") ?? "";

    await page.goto(link);
    await expect(
      panel(page).getByRole("heading", { name: OPERATION }),
    ).toBeVisible();
    await expect(panel(page)).toContainText("Denied · no rule covers it");
    await expectAccessible(page);
    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page).toHaveURL(/activity$/);

    const old = await page.goto(`${base}/activity/${id}`);
    expect(old?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`activity\\?event=${id}$`));
    await expect(panel(page)).toContainText("Denied · no rule covers it");
  });
});

test.describe("activity: views", () => {
  test("switches between events and runs, keeping shared filters", async ({
    page,
  }) => {
    const { base } = await withRequest(page, "Views");
    await page.goto(`${base}/activity?agent=support&kind=changes`);
    const views = page.getByRole("navigation", { name: "Activity view" });
    await expect(views.getByRole("link", { name: "Events" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await views.getByRole("link", { name: "Runs" }).click();
    await page.waitForURL(/activity\?view=runs&agent=support$/);
    await expect(views.getByRole("link", { name: "Runs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByLabel("Agent")).toHaveValue("support");
    await expect(page.getByLabel("Event kind")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export" })).toHaveCount(0);
    await expect(page.getByText("No runs match these filters")).toBeVisible();
    await expectAccessible(page);

    await views.getByRole("link", { name: "Events" }).click();
    await page.waitForURL(/activity\?agent=support$/);
    await expect(rows(page).first()).toBeVisible();
  });

  test("Insights replace Reports, and old addresses lead to the new ones", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Moved ${Date.now()}`);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await page.goto(`${base}/overview`);
    await expect(nav.getByRole("link", { name: "Runs" })).toHaveCount(0);
    await nav.getByRole("link", { name: "Insights" }).click();
    await page.waitForURL(/insights$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Insights" }),
    ).toBeVisible();

    for (const [from, to] of [
      ["runs", /activity\?view=runs$/],
      ["activity/runs", /activity\?view=runs$/],
      ["runs/reports?days=7", /insights\?days=7$/],
      ["runs/reports", /insights$/],
    ] as const) {
      await page.goto(`${base}/${from}`);
      await expect(page, from).toHaveURL(to);
    }
  });
});

test.describe("activity: export", () => {
  test("downloads the filtered events as CSV and JSON", async ({ page }) => {
    const { base, slug } = await withRequest(page, "Export");
    await seedDecision(slug, "support", {
      resource: '=HYPERLINK("http://evil.example","x")',
    });
    await page.goto(`${base}/activity?agent=support`);

    const csv = await exportAs(page, "CSV");
    expect(csv.download.suggestedFilename()).toMatch(/activity-.*\.csv$/);
    const lines = csv.text.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "time_utc,agent,installation,tool,operation,resource,outcome,decided_by,reason,run,request_id",
    );
    // Its two denials and its connection.
    expect(lines).toHaveLength(4);
    expect(csv.text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(csv.text).toContain(",denied,");

    await page.getByLabel("Outcome").selectOption("denied");
    await page.waitForURL(/outcome=denied/);
    await expect(rows(page)).toHaveCount(2);
    const json = await exportAs(page, "JSON");
    expect(json.download.suggestedFilename()).toMatch(/\.json$/);
    const parsed = JSON.parse(json.text) as {
      count: number;
      capped: boolean;
      events: { outcome: string; decided_by: string; resource: string }[];
    };
    expect(parsed).toMatchObject({ count: 2, capped: false });
    expect(parsed.events).toContainEqual(
      expect.objectContaining({
        outcome: "denied",
        resource: "acme/support#482",
      }),
    );

    // The export itself is recorded, for the person who made it.
    await page.goto(`${base}/activity?kind=changes`);
    await expect(
      rows(page).filter({ hasText: "Activity exported" }),
    ).toHaveCount(2);
  });

  test("a viewer exports only the agents assigned to them", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await withRequest(page, "Viewer export");
    await connect(page, base, "hidden");
    await seedDecision(slug, "hidden");
    const viewer = await addTeammate(browser, slug, "viewer");
    await assignAgent(slug, "support", viewer.email);
    await viewer.page.goto(`${base}/activity`);
    const { text } = await exportAs(viewer.page, "CSV");
    expect(text).toContain(",support,");
    expect(text).not.toContain("hidden");
    await viewer.page.context().close();
  });
});
