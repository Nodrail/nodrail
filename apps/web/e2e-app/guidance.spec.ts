import { expect, test, type Page } from "@playwright/test";
import {
  connect,
  createRule,
  expectAccessible,
  expectFitsPhone,
  seedDecision,
  startWorkspace,
  workspacePage,
} from "./helpers";

const tourCard = (page: Page) => page.locator("[data-slot=tour]");
const help = (page: Page) => page.locator("[data-slot=help-menu] summary");

/** Starts this page's tour from Help, as someone who has seen it would. */
async function replayTour(page: Page) {
  await help(page).click();
  await page
    .getByRole("button", { name: "Take the tour of this page" })
    .click();
}

/** A new person, who has seen no tour, with one decision recorded. */
async function freshWithRequest(page: Page, label: string) {
  const workspace = await startWorkspace(page, `${label} ${Date.now()}`, {
    tours: true,
  });
  await connect(page, workspace.base, "support");
  await seedDecision(workspace.slug, "support");
  return workspace;
}

/** Long enough for a tour that was going to open by itself to have opened. */
async function settled(page: Page) {
  await expect(page.locator("[data-slot=decision-row]")).toBeVisible();
  await page.waitForTimeout(1_000);
}

/**
 * Closes the open tour with this button: it doesn't come back on a reload,
 * and Help still replays this page's tour.
 */
async function closeThenReplay(page: Page, button: string) {
  const card = tourCard(page);
  await card.getByRole("button", { name: button }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await settled(page);
  await expect(card).toHaveCount(0);
  await replayTour(page);
}

test.describe("guided tours", () => {
  test("settings and account pages, in no environment, have theirs", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Manage ${Date.now()}`, {
      tours: true,
    });
    for (const [path, label, anchor] of [
      ["settings/general", "Workspace settings", "settings-nav"],
      ["account/tokens", "Your account", "account-nav"],
    ]) {
      await page.goto(workspacePage(base, path));
      const card = tourCard(page);
      // Only Overview opens its own by itself.
      await expect(page.locator(`[data-tour=${anchor}]`)).toBeVisible();
      await page.waitForTimeout(1_000);
      await expect(card).toHaveCount(0);
      await replayTour(page);
      await expect(card).toContainText(`${label} · Step 1 of 4`);
      await expect(page.locator(`[data-tour=${anchor}]`)).toHaveAttribute(
        "data-tour-active",
        "",
      );
      await expectAccessible(page);
      await card.getByRole("button", { name: "Skip tour" }).click();
      await expect(card).toHaveCount(0);
    }
  });

  test("Don't show tours keeps the others from opening by themselves", async ({
    page,
  }) => {
    const { base } = await freshWithRequest(page, "No tours");
    await page.goto(`${base}/overview`);
    const card = tourCard(page);
    await expect(card).toContainText("Step 1 of 5");
    await closeThenReplay(page, "Don't show tours");
    await expect(card).toBeVisible();
  });

  test("open once on a screen with data, and replay from Help", async ({
    page,
  }) => {
    const { base } = await freshWithRequest(page, "Tour");
    await page.goto(`${base}/overview`);
    const card = tourCard(page);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("role", "dialog");
    await expect(card).toContainText("Step 1 of 5");
    await expect(card).toHaveAttribute("data-placement", "anchored");
    await expect(card.getByRole("button", { name: "Next" })).toBeFocused();
    await expectAccessible(page);

    await card.getByRole("button", { name: "Next" }).click();
    await expect(card).toContainText("Step 2 of 5");
    await closeThenReplay(page, "Skip tour");
    await expect(card).toContainText("Step 1 of 5");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    await expect(help(page)).toBeFocused();
  });

  test("an agent's page and a form have theirs in Help", async ({ page }) => {
    const { base } = await freshWithRequest(page, "Agent tour");
    await page.goto(`${base}/agents/support/rules`);
    const card = tourCard(page);
    await expect(
      page.getByRole("heading", { name: "support", level: 1 }),
    ).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(card).toHaveCount(0);
    await replayTour(page);
    await expect(card).toContainText("Step 1 of 4");
    await expect(card).toContainText("How it stands, at a glance.");
    await expect(card).toHaveAttribute("data-placement", "anchored");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);

    await page.goto(`${base}/agents/connect`);
    await expect(page.getByLabel("Agent ID")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(card).toHaveCount(0);
    await replayTour(page);
    await expect(card).toContainText("Pick its host.");
    await expect(card).toHaveAttribute("data-placement", "anchored");
  });

  test("never open by themselves on an empty screen", async ({ page }) => {
    const { base } = await startWorkspace(page, `Empty ${Date.now()}`, {
      tours: true,
    });
    await page.goto(`${base}/overview`);
    await expect(page.locator("[data-slot=first-steps]")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(tourCard(page)).toHaveCount(0);
  });

  test("fit a phone, in the middle when the element is not there", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { base } = await freshWithRequest(page, "Phone tour");
    await page.goto(`${base}/overview`);
    await expect(tourCard(page)).toBeVisible();
    await expectFitsPhone(page);
    await page.keyboard.press("Escape");

    await page.goto(`${base}/policies`);
    await expect(
      page.getByRole("heading", { name: "No rules yet" }),
    ).toBeVisible();
    await replayTour(page);
    const card = tourCard(page);
    await expect(card).toHaveAttribute("data-placement", "centered");
    const box = await card.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(box?.y).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});

test.describe("first steps", () => {
  test("tick off as a new workspace connects an agent and adds a rule", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Steps ${Date.now()}`);
    const steps = page.locator("[data-slot=first-steps]");
    const progress = page.locator("[data-slot=first-steps-progress]");
    await expect(progress).toHaveText("0 of 4 done");
    await expect(
      steps.getByRole("button", { name: "Hide these steps" }),
    ).toBeVisible();

    await connect(page, base, "support");
    await page.goto(`${base}/overview`);
    await expect(progress).toHaveText("1 of 4 done");

    await createRule(page, base, {
      name: "Read issues",
      operation: "github.issues.list",
      resourceKind: "repository",
    });
    await page.goto(`${base}/overview`);
    await expect(progress).toHaveText("2 of 4 done");
    await expect(
      page.locator("[data-slot=first-step][data-step=rule]"),
    ).toHaveAttribute("data-done");
    await expectAccessible(page);

    await steps.getByRole("button", { name: "Hide these steps" }).click();
    await expect(steps).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
    await expect(steps).toHaveCount(0);
  });
});

test.describe("what's new", () => {
  test("shows a dot until it is opened", async ({ page }) => {
    const { base } = await startWorkspace(page, `News ${Date.now()}`);
    await page.goto(`${base}/agents`);
    await expect(help(page)).toHaveAccessibleName("Help, with something new");
    await help(page).click();
    await page.getByRole("button", { name: /What's new/ }).click();
    const dialog = page.getByRole("dialog", { name: "What's new" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-slot=whats-new-entry]")).not.toHaveCount(
      0,
    );
    await expectAccessible(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(help(page)).toHaveAccessibleName("Help");
    await page.reload();
    await expect(help(page)).toHaveAccessibleName("Help");
  });
});
