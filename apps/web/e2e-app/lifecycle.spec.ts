import { expect, test } from "@playwright/test";
import { connected, runHook, shell, server } from "./hook";
import {
  addTeammate,
  expectAccessible,
  requestLink,
  signInLink,
  startWorkspace,
  workspacePage,
} from "./helpers";

async function confirmIn(
  page: import("@playwright/test").Page,
  trigger: string,
  value: string,
) {
  await page
    .getByRole("button", { name: trigger, exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: /\?$/ });
  await dialog.getByRole("textbox").fill(value);
  await dialog.getByRole("button", { name: trigger, exact: true }).click();
}

test.describe("your data", () => {
  test("the workspace can be downloaded", async ({ page }) => {
    const { base } = await startWorkspace(page, `Export ${Date.now()}`);
    await page.goto(workspacePage(base, "settings/data"));
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download workspace data" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^nodrail-.*\.json$/);
    await expectAccessible(page);
  });

  test("a viewer cannot download it", async ({ page, browser, request }) => {
    const { base, slug } = await startWorkspace(page, `No ${Date.now()}`);
    const viewer = await addTeammate(browser, slug, "viewer");
    const data = await viewer.page.goto(workspacePage(base, "settings/data"));
    expect(data?.status()).toBe(404);
    await expect(
      viewer.page.getByRole("link", { name: "Download workspace data" }),
    ).toHaveCount(0);
    const response = await viewer.page.request.get(`/app/${slug}/export`);
    expect(response.status()).toBe(403);
    expect(
      (await request.get(`/app/${slug}/export`, { maxRedirects: 0 })).status(),
    ).toBe(307);
    await viewer.page.context().close();
  });

  test("archiving stops people and agents", async ({ page }) => {
    const { base, env } = await connected(page, "Close");
    await page.goto(workspacePage(base, "settings/general"));
    const workspaceName = await page.getByLabel("Workspace name").inputValue();
    await page.goto(workspacePage(base, "settings/data"));
    await confirmIn(page, "Archive workspace", workspaceName);
    await page.waitForURL(/\/app\/new$/);
    expect((await page.goto(`${base}/overview`))?.status()).toBe(404);
    const blocked = await runHook(shell("ls"), env);
    expect(blocked.stdout).toContain("credential was refused");
  });

  test("an owner is told to hand over first", async ({ page }) => {
    const { base, email } = await startWorkspace(page, `Own ${Date.now()}`);
    await page.goto(workspacePage(base, "account/privacy"));
    await confirmIn(page, "Delete my account", email);
    await expect(
      page.locator("dialog [data-slot=field-error]").last(),
    ).toContainText("Transfer it or archive it");
  });

  test("after archiving their only workspace, an owner can delete their account", async ({
    page,
  }) => {
    const name = `Last ${Date.now()}`;
    const { base, email } = await startWorkspace(page, name);
    await page.goto(workspacePage(base, "settings/data"));
    await page.getByRole("button", { name: "Archive workspace" }).click();
    const dialog = page.getByRole("dialog", { name: /\?$/ });
    await expect(dialog).toContainText("You can't undo this");
    await expect(
      dialog.getByRole("link", { name: "Download workspace data" }),
    ).toHaveAttribute("href", /\/export$/);
    await page.keyboard.press("Escape");
    await confirmIn(page, "Archive workspace", name);
    await page.waitForURL(/\/app\/new$/);
    // Deleting the account waits behind its own disclosure.
    await expect(
      page.getByRole("button", { name: "Delete my account" }),
    ).toBeHidden();
    await page.getByText("Account options").click();
    await confirmIn(page, "Delete my account", email);
    await page.waitForURL(/\/login$/);
  });

  test("deleting an account ends it, and the address can start over", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Del ${Date.now()}`);
    const member = await addTeammate(browser, slug, "viewer");
    await member.page.goto(workspacePage(base, "account/privacy"));
    await confirmIn(member.page, "Delete my account", member.email);
    await member.page.waitForURL(/\/login$/);

    await page.goto(workspacePage(base, "settings/members"));
    await expect(page.getByText(member.email)).toHaveCount(0);

    const fresh = await (await browser.newContext()).newPage();
    const previous = await requestLink(fresh, member.email);
    const { url } = await signInLink(member.email, previous);
    await fresh.goto(url);
    await fresh.getByRole("button", { name: "Continue to Nodrail" }).click();
    await fresh.waitForURL(/\/app\/new$/);
    await fresh.context().close();
    await member.page.context().close();
  });
});

test.describe("operations", () => {
  test("health reports only whether the service works", async ({ request }) => {
    const response = await request.get(`${server}/api/health`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
