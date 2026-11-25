import { expect, test, type Page } from "@playwright/test";
import {
  createWorkspace,
  expectAccessible,
  newEmail,
  signIn,
  startWorkspace,
  workspacePage,
} from "./helpers";

const sidebar = (page: Page) => page.locator("#sidebar");
const column = (page: Page) => page.locator("#page").locator("..");

/** Running animations on the sidebar and the column beside it. */
const moving = (page: Page) =>
  page.evaluate(
    () =>
      [
        document.getElementById("sidebar"),
        document.getElementById("page")?.parentElement,
      ].flatMap((element) => element?.getAnimations() ?? []).length,
  );

/** Where the sidebar ends and where the content starts, in pixels. */
const edges = (page: Page) =>
  page.evaluate(() => ({
    sidebar: document.getElementById("sidebar")?.getBoundingClientRect().right,
    content: document.getElementById("page")?.getBoundingClientRect().left,
  }));

/** Whether the focused element is inside the selector's element. */
const focusIn = (page: Page, selector: string) =>
  page.evaluate(
    (inside) => !!document.activeElement?.closest(inside),
    selector,
  );

test.describe("the app shell", () => {
  test("menus close with Escape and return focus", async ({ page }) => {
    await startWorkspace(page, `Menus ${Date.now()}`);
    const trigger = page.getByLabel(/your account/i);
    await trigger.click();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("a menu closes when focus leaves it", async ({ page }) => {
    await startWorkspace(page, `Focus out ${Date.now()}`);
    const menu = page.locator("[data-slot=workspace-menu]");
    await menu.locator("> summary").focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(menu).toHaveAttribute("open", "");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeFocused();
    await expect(menu).not.toHaveAttribute("open");
  });

  test("the sidebar shows names until the person collapses it", async ({
    page,
  }) => {
    await startWorkspace(page, `Sidebar ${Date.now()}`);
    await expect(page.locator("[data-slot=nav-text]").first()).toBeVisible();
    await expect(sidebar(page)).toHaveCSS("width", "224px");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sidebar(page)).toHaveCSS("width", "72px");
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    await expect(sidebar(page)).toHaveCSS("width", "72px");
  });

  test("the sidebar never slides over the page when it loads or mounts again", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Motion ${Date.now()}`);
    // Settings and environment pages each mount the frame anew.
    for (const path of [
      workspacePage(base, "settings/members"),
      `${base}/agents`,
    ]) {
      await page.goto(path);
      expect(await moving(page)).toBe(0);
      // The content starts where the sidebar ends, never under it.
      expect(await edges(page)).toEqual({ sidebar: 224, content: 224 });
    }
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.getByRole("link", { name: "Overview" }).click();
    await page.waitForURL(/\/overview$/);
    await page.locator("[data-slot=workspace-menu] > summary").click();
    await page.getByRole("link", { name: "Members" }).click();
    await page.waitForURL(/\/settings\/members$/);
    expect(await moving(page)).toBe(0);
    await expect(sidebar(page)).toHaveCSS("width", "72px");
    await expect(column(page)).toHaveCSS("margin-left", "72px");
  });

  test("the collapsed rail names each link on keyboard focus", async ({
    page,
  }) => {
    await startWorkspace(page, `Names ${Date.now()}`);
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    for (const name of ["Overview", "Agents", "Activity"])
      await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Agents", exact: true }).focus();
    const label = page.locator("[data-slot=rail-label]");
    await expect(label).toBeVisible();
    await expect(label).toContainText("Agents");
    await page.keyboard.press("Escape");
    await expect(label).toBeHidden();
  });

  test("the top bar never covers the focused control", async ({ page }) => {
    await startWorkspace(page, `Scroll ${Date.now()}`);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollPaddingTop,
      ),
    ).toBe("72px");
  });

  test("Production is marked apart from Development", async ({ page }) => {
    const { base } = await startWorkspace(page, `Tone ${Date.now()}`);
    const chip = page.locator("[data-slot=environment-context]");
    await expect(chip).toHaveText("Development");
    await expect(chip.locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    await page.goto(base.replace(/development$/, "production/overview"));
    await expect(chip).toHaveText("Production");
    await expect(chip.locator("[data-tone]")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the whole flow fits and navigates", async ({ page }) => {
    await signIn(page, newEmail(), "/signup");
    await createWorkspace(page, `Phone ${Date.now()}`);
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    expect(await fits()).toBe(true);
    await expect(
      page.locator("[data-slot=environment-context]"),
    ).toBeInViewport();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    const agents = page.getByRole("link", { name: "Agents" });
    await expect(agents).toBeInViewport();
    await agents.click();
    await expect(
      page.getByRole("heading", { name: "Agents", level: 1 }),
    ).toBeVisible();
    await expect(agents).not.toBeInViewport();
    expect(await fits()).toBe(true);
    await expectAccessible(page);
  });

  test("the closed drawer takes no focus", async ({ page }) => {
    await startWorkspace(page, `Closed ${Date.now()}`);
    await expect(page.getByRole("link", { name: "Agents" })).toBeHidden();
    await page.locator("body").focus();
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIn(page, "#sidebar")).toBe(false);
    }
  });

  test("the open drawer holds focus, and Escape or the backdrop give it back", async ({
    page,
  }) => {
    await startWorkspace(page, `Drawer ${Date.now()}`);
    const toggle = page.getByRole("button", { name: /sidebar/ });
    const agents = page.getByRole("link", { name: "Agents" });
    await toggle.click();
    await expect(
      page.getByRole("dialog", { name: "Workspace navigation" }),
    ).toBeVisible();
    await expect(agents).toBeInViewport();
    expect(await focusIn(page, "#sidebar")).toBe(true);
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press("Tab");
      expect(await focusIn(page, "#page, [data-slot=topbar]")).toBe(false);
    }
    await page.keyboard.press("Escape");
    await expect(agents).not.toBeInViewport();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(agents).not.toBeInViewport();
    await expect(toggle).toBeFocused();
  });

  test("a menu taller than the screen scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 420 });
    await startWorkspace(page, `Short ${Date.now()}`);
    await page.locator("[data-slot=workspace-menu] > summary").click();
    const create = page.getByRole("link", { name: "Create a workspace" });
    await create.scrollIntoViewIfNeeded();
    await expect(create).toBeInViewport();
    await create.click();
    await page.waitForURL(/\/app\/new$/);
  });

  test("stacked tables name each value", async ({ page }) => {
    const { base } = await startWorkspace(page, `Stacked ${Date.now()}`);
    await page.goto(workspacePage(base, "settings/members"));
    const role = page.getByRole("cell", { name: /Owner/ });
    await expect(role).toHaveAttribute("data-label", "Role");
    expect(
      await role.evaluate((cell) => getComputedStyle(cell, "::before").content),
    ).toMatch(/Role/);
    await expect(
      page.getByRole("columnheader", { name: "Role" }),
    ).toBeAttached();
    await expectAccessible(page);
  });
});
