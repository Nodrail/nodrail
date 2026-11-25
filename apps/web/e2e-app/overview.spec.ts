import { expect, test, type Page } from "@playwright/test";
import {
  addTeammate,
  assignAgent,
  confirm,
  connect,
  expectAccessible,
  expectFitsPhone,
  seedDecision,
  setLastSeen,
  workspaceWithDecision as withDecision,
} from "./helpers";

// While a streamed section renders again, React can keep its previous copy
// in the page, hidden. Only what a person can see counts.
const tile = (page: Page, name: string) =>
  page
    .locator(`[data-slot=health-tile][data-tile=${name}]`)
    .filter({ visible: true });
const count = (page: Page, outcome: string) =>
  page
    .locator(`[data-slot=today-count][data-outcome=${outcome}]`)
    .filter({ visible: true });
const figure = (page: Page, outcome: string) =>
  count(page, outcome).locator("[data-slot=tile-figure]");
const activityRows = (page: Page) =>
  page.locator("[data-slot=data-table] tbody tr");
const decisions = (page: Page) => page.locator("[data-slot=decision-row]");

/** A workspace past setup: its agent has checked in and a call was denied. */
async function checkedIn(page: Page, label: string, agent = "support") {
  const workspace = await withDecision(page, label, agent);
  await setLastSeen(workspace.slug, agent, 1);
  return workspace;
}

test.describe("overview", () => {
  test("says how things stand and what happened", async ({ page }) => {
    const { base, slug } = await withDecision(page, "Figures", "support");
    await connect(page, base, "research");
    await connect(page, base, "billing");
    await setLastSeen(slug, "support", 2);
    await setLastSeen(slug, "research", 90);

    await page.goto(`${base}/overview`);
    // Nothing waits for a person: there is no queue and no Approvals link.
    await expect(page.locator("[data-slot=needs-you]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Approvals/ })).toHaveCount(0);
    await expect(tile(page, "agents")).toContainText("1 of 3");
    await expect(tile(page, "agents")).toContainText(
      "Silent: research, billing",
    );
    // Silent agents are problems too, each linked to its fix.
    await expect(tile(page, "problems")).toContainText("2 problems");
    await expect(tile(page, "problems")).toContainText(
      "Silent: research-dev, last check-in",
    );
    await expect(figure(page, "denied")).toHaveText("1");
    await expect(decisions(page)).toHaveCount(1);
    await expect(decisions(page)).toContainText("Denied — no rule covers it");
    await expectAccessible(page);

    await decisions(page).click();
    await page.waitForURL(/activity\?(.+&)?event=[0-9a-f-]{36}$/);
    await expect(page.getByRole("dialog")).toContainText(
      "Denied · no rule covers it",
    );
  });

  test("the first steps stay at the top until they are done", async ({
    page,
  }) => {
    const { base } = await checkedIn(page, "Steps first");
    await page.goto(`${base}/overview`);
    const steps = page.locator("[data-slot=first-steps]");
    await expect(steps).toBeVisible();
    await expect(steps).not.toHaveAttribute("data-folded", "");
    await expect(
      page.locator("[data-slot=first-steps-progress]"),
    ).toContainText("of 4 done");
    await expect(page.locator("[data-slot=first-step]").first()).toBeVisible();
    await expectAccessible(page);
  });

  test("health tiles lead to where each is fixed", async ({ page }) => {
    const { base } = await checkedIn(page, "Tiles");
    await page.goto(`${base}/overview`);
    await tile(page, "agents").click();
    await page.waitForURL(/agents$/);

    await page.goto(`${base}/overview`);
    await expect(tile(page, "usage")).toContainText("Agent actions");
    await tile(page, "usage").click();
    await page.waitForURL(/settings\/billing#billing-usage$/);
    await expect(page.locator("#billing-usage")).toBeVisible();
  });

  test("today's counts open Activity filtered the same way", async ({
    page,
  }) => {
    const { base, slug } = await checkedIn(page, "Counts");
    await seedDecision(slug, "support", { resource: "acme/support#5" });
    await page.goto(`${base}/overview`);

    await expect(figure(page, "denied")).toHaveText("2");
    await count(page, "denied").click();
    await page.waitForURL(/activity\?outcome=denied&range=24h$/);
    await expect(activityRows(page)).toHaveCount(2);
    await expect(activityRows(page).first()).toContainText(
      "Denied · no rule covers it",
    );
    await expect(count(page, "waiting")).toHaveCount(0);
  });

  test("a pause shows on the agents tile", async ({ page }) => {
    const { base } = await checkedIn(page, "Paused");
    await page.goto(`${base}/agents/support/settings`);
    await confirm(page, "Pause", "Pause agent");
    await page.goto(`${base}/overview`);
    await expect(tile(page, "agents")).toContainText("Paused: support");
  });

  test("a person only counts what is assigned to them", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await checkedIn(page, "Mine", "mine");
    await connect(page, base, "theirs");
    await seedDecision(slug, "theirs");
    await page.goto(`${base}/overview`);
    await expect(decisions(page)).toHaveCount(2);

    const viewer = await addTeammate(browser, slug, "viewer");
    await viewer.page.goto(`${base}/overview`);
    await expect(
      viewer.page.getByRole("heading", {
        name: "No agents are assigned to you yet",
      }),
    ).toBeVisible();

    await assignAgent(slug, "mine", viewer.email);
    await viewer.page.goto(`${base}/overview`);
    await expect(decisions(viewer.page)).toHaveCount(1);
    await expect(tile(viewer.page, "agents")).toContainText("1 of 1");
    await viewer.page.context().close();
  });

  test("a very long resource never widens the page", async ({ page }) => {
    const { base, slug } = await checkedIn(page, "Long resource");
    // Like a shell heredoc an agent sends, at the longest a resource may be.
    const resource = 'grep -n "h1\\|code" src/styles/base.css | head -30; '
      .repeat(9)
      .slice(0, 500);
    // Several, so they also fold into a group.
    for (const n of [1, 2, 3])
      await seedDecision(slug, "support", {
        tool: "shell",
        operation: "command.run",
        kind: "command",
        resource: `${n} ${resource}`.slice(0, 500),
      });
    for (const width of [1440, 910, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/overview`);
      // Whatever an agent sends, even one unbroken 3,000-character line.
      await page
        .locator("[data-slot=decision-row] code")
        .first()
        .evaluate((node) => {
          node.textContent += "y".repeat(3000);
        });
      const scrollWidth = await page.evaluate(
        () => document.documentElement.scrollWidth,
      );
      expect(scrollWidth, `${width}px`).toBeLessThanOrEqual(width);
    }
  });

  test("works on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { base } = await checkedIn(page, "Phone overview");
    await page.goto(`${base}/overview`);
    await expect(decisions(page)).toHaveCount(1);
    await expect(tile(page, "agents")).toBeVisible();
    await expect(count(page, "allowed")).toBeVisible();
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});
