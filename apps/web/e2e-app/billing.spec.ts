import { expect, test, type Page } from "@playwright/test";
import { connected, runHook, server, shell } from "./hook";
import {
  addTeammate,
  expectAccessible,
  expectFitsPhone,
  setUsage,
  startWorkspace,
  viewerOn,
  workspaceOnPhone,
  withDatabase,
  workspacePage,
} from "./helpers";

const stripe = "http://127.0.0.1:12122";

const billing = (base: string) => workspacePage(base, "settings/billing");

const plan = (page: Page) => page.locator("[data-slot=fact-list] dd").first();

async function upgrade(page: Page, base: string) {
  await page.goto(billing(base));
  await page.getByRole("button", { name: /^Upgrade to Pro/ }).click();
  await page.waitForURL(`${stripe}/checkout/**`);
}

async function becomePro(page: Page, base: string) {
  await upgrade(page, base);
  await page.getByRole("button", { name: "Pay" }).click();
  await page.waitForURL(/billing=success/);
  await expect
    .poll(async () => {
      await page.reload();
      return plan(page).textContent();
    })
    .toBe("Pro");
}

const customerOf = async (slug: string) =>
  withDatabase(async (client) => {
    const { rows } = await client.query<{ stripe_customer_id: string }>(
      `SELECT b.stripe_customer_id FROM nodrail.workspace_billing b
       JOIN nodrail.workspaces w ON w.id = b.workspace_id WHERE w.slug = $1`,
      [slug],
    );
    return rows[0]?.stripe_customer_id ?? "";
  });

test.describe("subscribing", () => {
  test("checkout through to a paid plan, using the real SDK", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Paid ${Date.now()}`);
    await page.goto(billing(base));
    await expect(plan(page)).toHaveText("Free");
    await expect(page.getByText("0 of 1,000 agent actions")).toBeVisible();
    // What happens at the limit is said before it is near.
    await expect(
      page.getByText(/^At the limit, new agent actions are blocked/),
    ).toBeVisible();
    await expect(
      page.getByText(/run steps this month, included/),
    ).toBeVisible();
    await expectAccessible(page);

    await becomePro(page, base);
    await expect(page.getByText("0 of 100,000 agent actions")).toBeVisible();
    await expect(page.getByText(/^Renews$/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Upgrade to Pro/ }),
    ).toHaveCount(0);

    await page.goto(`${base}/activity?kind=changes`);
    await expect(
      page
        .locator("[data-slot=data-table] tbody tr")
        .filter({ hasText: "Plan changed" }),
    ).toContainText("free → pro");
  });

  test("leaving checkout changes nothing and says so", async ({ page }) => {
    const { base } = await startWorkspace(page, `Leave ${Date.now()}`);
    await upgrade(page, base);
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL(/billing=cancelled/);
    await expect(page.getByText("No change was made")).toBeVisible();
    await expect(plan(page)).toHaveText("Free");
  });

  test("a declined card changes nothing", async ({ page }) => {
    const { base } = await startWorkspace(page, `Decline ${Date.now()}`);
    await upgrade(page, base);
    await page.getByRole("button", { name: "Use a declined card" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.waitForURL(/billing=cancelled/);
    await expect(plan(page)).toHaveText("Free");
  });

  test("cancelling keeps the plan until the period ends", async ({ page }) => {
    const { base } = await startWorkspace(page, `Cancel ${Date.now()}`);
    await becomePro(page, base);
    await page.getByRole("button", { name: "Manage billing" }).click();
    await page.waitForURL(`${stripe}/portal/**`);
    await page.getByRole("button", { name: "Cancel plan" }).click();
    await page.waitForURL(/\/settings\/billing$/);
    await expect
      .poll(async () => {
        await page.reload();
        return page.getByText(/^Ends$/).count();
      })
      .toBe(1);
    await expect(plan(page)).toHaveText("Pro");
  });

  test("a failed payment is explained and the plan is kept", async ({
    page,
    request,
  }) => {
    const { base, slug } = await startWorkspace(page, `Fail ${Date.now()}`);
    await becomePro(page, base);
    const customer = await customerOf(slug);
    const live = await (
      await request.post(`${stripe}/__control/customer/${customer}`)
    ).json();
    await request.post(`${stripe}/__control/subscription/${live.id}`, {
      data: { status: "past_due" },
    });
    await expect
      .poll(async () => {
        await page.reload();
        return page.getByText("Your last payment failed").count();
      })
      .toBe(1);
    await expect(plan(page)).toHaveText("Pro");
  });

  test("fits a phone", async ({ page }) => {
    const { base } = await workspaceOnPhone(page, "Phone");
    await page.goto(billing(base));
    await expect(plan(page)).toHaveText("Free");
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});

test.describe("who can do what", () => {
  test("an admin sees the plan, only the owner can change it", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Admin ${Date.now()}`);
    const admin = await addTeammate(browser, slug, "admin");
    await admin.page.goto(billing(base));
    await expect(
      admin.page.getByText("Only the workspace owner can change the plan."),
    ).toBeVisible();
    await expect(
      admin.page.getByRole("button", { name: /Upgrade/ }),
    ).toHaveCount(0);
    await admin.page.context().close();
  });

  test("other roles do not see billing", async ({ page, browser }) => {
    const { base, viewer } = await viewerOn(
      page,
      browser,
      "Viewer",
      "overview",
    );
    await viewer.locator("[data-slot=workspace-menu] > summary").click();
    await expect(
      viewer.getByRole("link", { name: /Billing & usage/ }),
    ).toHaveCount(0);
    const response = await viewer.goto(billing(base));
    expect(response?.status()).toBe(404);
    await expect(
      viewer.getByRole("heading", { name: "Plan and usage" }),
    ).toHaveCount(0);
    await viewer.context().close();
  });
});

test.describe("the allowance", () => {
  test("past it, the agent is blocked and everyone can see why", async ({
    page,
  }) => {
    const { base, slug, env } = await connected(page, "Limit");
    await setUsage(slug, 1000);
    const blocked = await runHook(shell("npm publish"), env);
    expect(blocked.stdout).toContain("used its agent actions");
    expect(blocked.stdout).toContain('"permissionDecision":"deny"');

    await page.goto(`${base}/overview`);
    await expect(
      page.getByRole("main").getByText(/New agent actions are blocked/),
    ).toBeVisible();
    await expect(page.locator("[data-slot=usage-banner]")).toContainText(
      "New agent actions are blocked until",
    );
    await expectAccessible(page);
  });

  test("upgrading lifts it for the very next call", async ({ page }) => {
    const { base, slug, env } = await connected(page, "Lift");
    await setUsage(slug, 1000);
    await becomePro(page, base);
    const after = await runHook(shell("npm publish"), env);
    // Under the allowance again: no rule covers it, so it is denied at once,
    // not for the month.
    expect(after.stdout).toContain("this action is denied");
    expect(after.stdout).not.toContain("used its agent actions");
  });
});

test.describe("the webhook", () => {
  test("refuses anything unsigned or forged", async ({ request }) => {
    const url = `${server}/api/webhooks/stripe`;
    expect((await request.post(url, { data: "{}" })).status()).toBe(400);
    expect(
      (
        await request.post(url, {
          data: "{}",
          headers: { "stripe-signature": "t=1,v1=forged" },
        })
      ).status(),
    ).toBe(400);
  });
});
