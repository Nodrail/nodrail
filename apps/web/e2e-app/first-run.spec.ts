import { expect, test, type Page } from "@playwright/test";
import {
  assignAgent,
  createRule,
  createWorkspace,
  expectAccessible,
  expectFitsPhone,
  newEmail,
  openStandaloneSetup,
  seedClientReport,
  seedDecision,
  setLastSeen,
  setAuthSource,
  signIn,
  signInLink,
  startWorkspace,
  viewerOn,
  workspaceOnPhone,
  whileMembershipLocked,
  workspacePage,
  workspaceWithDecision,
} from "./helpers";

const step = (page: Page, key: string) =>
  page.locator(`[data-slot=first-step][data-step=${key}]`);
const firstSteps = (page: Page) => page.locator("[data-slot=first-steps]");

test.describe("the first run", () => {
  test("from a new account to a reviewed decision and a teammate", async ({
    page,
    browser,
  }) => {
    await signIn(page, newEmail(), "/signup");
    await page.waitForURL(/\/app\/new$/);
    await createWorkspace(page, `Journey ${Date.now()}`);
    const base = new URL(page.url()).pathname.replace("/overview", "");
    const slug = base.split("/")[2] ?? "";

    await expect(page.getByText("0 of 3 done")).toBeVisible();
    await expect(step(page, "agent")).toHaveAttribute("aria-current", "step");
    await expectAccessible(page);

    await page.getByRole("link", { name: "Connect a project" }).click();
    await page.waitForURL(/agents\/connect$/);
    await openStandaloneSetup(page);
    await page.getByLabel("Agent ID").fill("support");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByLabel("Agent credential")).toBeVisible();

    await page.goto(`${base}/overview`);
    await expect(step(page, "agent")).toContainText("first check-in");
    await expect(step(page, "agent")).not.toHaveAttribute("data-done");

    await setLastSeen(slug, "support", 1);
    await seedDecision(slug, "support");
    await page.goto(`${base}/overview`);
    // An agent connected and a first decision recorded: nothing waits for a person.
    await expect(firstSteps(page)).toHaveCount(0);
    await expect(
      page
        .locator("[data-slot=health-tile][data-tile=agents]")
        .filter({ visible: true }),
    ).toContainText("1 of 1");

    await createRule(page, base, {
      name: "Read issues",
      operation: "github.issues.list",
      resourceKind: "repository",
    });

    await seedClientReport(slug, "support", "success");
    await page.goto(`${base}/activity`);
    const decision = page
      .locator("[data-slot=data-table] tbody tr")
      .filter({ hasText: "github.issues.delete" });
    await expect(decision).toContainText("Denied · no rule covers it");
    await expect(decision).toContainText("Client reported success");

    await page.goto(workspacePage(base, "settings/members"));
    await page.getByRole("button", { name: "Invite teammate" }).click();
    const email = newEmail();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create invite link" }).click();
    const link = page.getByLabel("Invite link", { exact: true });
    await expect(link).toBeVisible();
    const inviteUrl = (await link.textContent()) ?? "";

    const guest = await (await browser.newContext()).newPage();
    await setAuthSource(guest);
    await guest.goto(inviteUrl);
    await guest.waitForURL(/\/login/);
    await guest.getByRole("link", { name: "Create an account" }).click();
    await expect(
      guest.getByRole("heading", { name: "Create an account to join" }),
    ).toBeVisible();
    await guest.getByLabel("Email").fill(email);
    await guest.getByRole("button", { name: "Continue with email" }).click();
    await expect(guest.getByRole("status")).toContainText("Check your email");
    const { url } = await signInLink(email);
    await guest.goto(url);
    await guest.getByRole("button", { name: "Continue to Nodrail" }).click();
    await guest.getByRole("button", { name: /^Join / }).click();
    await guest.waitForURL(/\/overview$/);
    await assignAgent(slug, "support", email);
    await guest.goto(`${base}/activity`);
    await expect(
      guest.locator("[data-slot=data-table] tbody tr").filter({
        hasText: "github.issues.delete",
      }),
    ).toContainText("Denied · no rule covers it");
    await guest.context().close();
  });

  test("someone with no workspace yet can still sign out", async ({ page }) => {
    await signIn(page, newEmail(), "/signup");
    await page.waitForURL(/\/app\/new$/);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
  });

  test("the guide appears in an environment still to set up", async ({
    page,
  }) => {
    const { base, slug } = await workspaceWithDecision(page, "Second env");
    await setLastSeen(slug, "support", 1);
    await page.goto(`${base}/overview`);
    await expect(firstSteps(page)).toHaveCount(0);
    await page.goto(`${base.replace("development", "production")}/overview`);
    await expect(step(page, "agent")).toHaveAttribute("aria-current", "step");
  });

  test("someone who cannot connect agents is not shown it", async ({
    page,
    browser,
  }) => {
    const { base, viewer } = await viewerOn(page, browser, "Guide", "overview");
    await expect(firstSteps(viewer)).toHaveCount(0);
    await viewer.goto(`${base}/agents`);
    await expect(
      viewer.getByRole("heading", { name: "No agents to show yet" }),
    ).toBeVisible();
    await viewer.context().close();
  });

  test("fits a phone", async ({ page }) => {
    const { base } = await workspaceOnPhone(page, "Phone");
    await page.goto(`${base}/overview`);
    await expect(firstSteps(page)).toBeVisible();
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});

test.describe("when things go wrong", () => {
  test("an unavailable page explains itself and recovers", async ({ page }) => {
    const { base, slug, email } = await startWorkspace(
      page,
      `Down ${Date.now()}`,
    );
    await whileMembershipLocked(slug, email, async () => {
      await page.goto(`${base}/overview`);
      await expect(
        page.getByRole("heading", { name: "We couldn't load Nodrail" }),
      ).toBeVisible({ timeout: 15_000 });
      await expectAccessible(page);
    });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();
  });

  test("a failed save keeps what was typed", async ({ page }) => {
    const { base, slug, email } = await startWorkspace(
      page,
      `Save ${Date.now()}`,
    );
    await page.goto(workspacePage(base, "settings/general"));
    await page.getByLabel("Workspace name").fill("Kept name");
    const save = page.getByRole("button", { name: "Save changes" }).first();
    await whileMembershipLocked(slug, email, async () => {
      await save.click();
      await expect(page.locator("[data-slot=field-error]")).toContainText(
        "Try again in a moment",
        { timeout: 15_000 },
      );
    });
    await expect(page.getByLabel("Workspace name")).toHaveValue("Kept name");
    await save.click();
    await expect(page.getByText("Workspace saved.")).toBeVisible();
  });

  test("a missing page stays inside the workspace", async ({ page }) => {
    const { base } = await startWorkspace(page, `Lost ${Date.now()}`);
    for (const path of ["bogus", "agents/ghost", "activity/not-an-event"]) {
      const response = await page.goto(`${base}/${path}`);
      expect(response?.status(), path).toBe(404);
      await expect(
        page.getByRole("heading", { name: "We can't find that page" }),
      ).toBeVisible();
      await expect(page.getByRole("navigation").first()).toBeVisible();
      await expectAccessible(page);
    }
    await page.getByRole("link", { name: "Go to Overview" }).click();
    await page.waitForURL(/\/overview$/);
  });
});

test.describe("every page, every width", () => {
  const PAGES = [
    "overview",
    "agents",
    "agents/support",
    "agents/support/rules",
    "agents/support/runs",
    "agents/support/settings",
    "agents/connect",
    "policies",
    "policies/gates",
    "policies/budgets",
    "policies/yaml",
    "policies/new",
    "activity",
    "activity?view=changes",
  ].map((path) => (base: string) => `${base}/${path}`);
  const WORKSPACE_PAGES = [
    "settings/general",
    "settings/members",
    "settings/billing",
    "settings/data",
    "account/notifications",
    "account/tokens",
    "account/privacy",
  ].map((path) => (base: string) => workspacePage(base, path));

  for (const width of [1440, 390])
    test(`at ${width}px`, async ({ page }) => {
      const { base, slug } = await workspaceWithDecision(
        page,
        `Sweep ${width}`,
      );
      await setLastSeen(slug, "support", 1);
      await seedClientReport(slug, "support", "failure", { note: "x" });
      await createRule(page, base, {
        name: "Read issues",
        operation: "github.issues.list",
        resourceKind: "repository",
      });
      await page.setViewportSize({ width, height: 900 });
      for (const pathOf of [...PAGES, ...WORKSPACE_PAGES]) {
        const path = pathOf(base);
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        await expect(page.locator("h1"), path).toHaveCount(1);
        await expect(page).toHaveTitle(/ · Nodrail$/);
        if (width === 390) await expectFitsPhone(page);
        await expectAccessible(page);
      }
    });

  test("dialogs are accessible and give focus back", async ({ page }) => {
    const { base } = await workspaceWithDecision(page, "Dialogs");
    await page.goto(workspacePage(base, "settings/members"));
    const invite = page.getByRole("button", { name: "Invite teammate" });
    await invite.click();
    await expect(page.getByLabel("Email")).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(invite).toBeFocused();

    await page.goto(`${base}/agents/support/settings`);
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await pause.click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Cancel" }),
    ).toBeFocused();
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await expect(pause).toBeFocused();
  });

  test("the keyboard reaches the page first", async ({ page }) => {
    const { base } = await startWorkspace(page, `Keys ${Date.now()}`);
    await page.goto(`${base}/agents`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /skip/i });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });
});
