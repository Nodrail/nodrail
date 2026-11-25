import { expect, test, type Page } from "@playwright/test";
import { connected, runHook, shell } from "./hook";
import {
  addTeammate,
  expectAccessible,
  setUsage,
  startWorkspace,
  waitForMail,
  workspacePage,
} from "./helpers";

const banner = (page: Page) => page.locator("[data-slot=usage-banner]");

test.describe("usage banners", () => {
  test("the owner is warned at 80 %, can dismiss it, and sees 100 % again", async ({
    page,
  }) => {
    const { base, slug } = await startWorkspace(page, `Near ${Date.now()}`);
    await setUsage(slug, 850);
    await page.goto(`${base}/overview`);
    await expect(banner(page)).toContainText(
      "850 of 1,000 agent actions used this month (85%).",
    );
    await expect(banner(page)).toHaveAttribute("data-tone", "warning");
    await expectAccessible(page);
    await banner(page).getByRole("link", { name: "Upgrade" }).click();
    await page.waitForURL(/\/settings\/billing#billing-usage$/);

    await banner(page)
      .getByRole("button", { name: "Dismiss this notice" })
      .click();
    await expect(banner(page)).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("850 of 1,000 agent actions")).toBeVisible();
    await expect(banner(page)).toHaveCount(0);

    await setUsage(slug, 1000);
    await page.goto(`${base}/agents`);
    await expect(banner(page)).toHaveAttribute("data-tone", "danger");
    await expect(banner(page)).toContainText(
      "All 1,000 agent actions this month are used. New agent actions are blocked until",
    );
  });

  test("others see only that agents are paused, and whom to ask", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Paused ${Date.now()}`);
    const viewer = await addTeammate(browser, slug, "viewer");
    await setUsage(slug, 900);
    await viewer.page.goto(`${base}/overview`, { waitUntil: "networkidle" });
    await expect(
      viewer.page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
    await expect(banner(viewer.page)).toHaveCount(0);

    await setUsage(slug, 1000);
    await viewer.page.reload();
    await expect(banner(viewer.page)).toContainText(
      /^New agent actions are paused until .+; ask your workspace owner\.$/,
    );
    await expect(banner(viewer.page).getByRole("link")).toHaveCount(0);
    await viewer.page.context().close();
  });
});

test.describe("recommending Pro", () => {
  test("the billing card says why, with the numbers", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Why ${Date.now()}`);
    await setUsage(slug, 912, { monthsAgo: 1 });
    await setUsage(slug, 845, { monthsAgo: 2 });
    await page.goto(workspacePage(base, "settings/billing"));
    await expect(
      page.locator("[data-slot=upgrade-recommendation]"),
    ).toContainText(
      /used more than 80% of its agent actions in each of the last 2 months \(912 in \w+, 845 in \w+\)\. Pro raises the allowance to 100,000 agent actions a month for \$29 a month\. Policy controls are the same on Free and Pro\./,
    );
  });

  test("nothing is recommended without a reason", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `None ${Date.now()}`);
    await setUsage(slug, 100);
    await page.goto(workspacePage(base, "settings/billing"));
    await expect(page.getByText("100 of 1,000 agent actions")).toBeVisible();
    await expect(
      page.locator("[data-slot=upgrade-recommendation]"),
    ).toHaveCount(0);
  });
});

test.describe("usage email", () => {
  test("crossing 80 % emails the owner", async ({ page }) => {
    const { email, slug, env } = await connected(page, "Mail80");
    await setUsage(slug, 799);
    await runHook(shell("npm publish"), env);
    const mail = await waitForMail(
      email,
      /You've used 80% of this month's agent actions in Mail80/,
    );
    expect(mail.Text).toContain("has used 800 of its 1,000 agent actions");
    expect(mail.Text).toContain("Nothing is charged automatically");
    expect(mail.Text).toMatch(
      /See plan and usage: \S+\/settings\/billing#billing-usage/,
    );
  });
});
