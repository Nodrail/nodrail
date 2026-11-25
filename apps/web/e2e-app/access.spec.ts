import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../src/server/auth/cookie-name";
import { tokenDigest } from "../src/server/auth/token";
import {
  addTeammate,
  createWorkspace,
  expectAccessible,
  newEmail,
  requestLink,
  setAuthSource,
  signIn,
  signOut,
  signInLink,
  startWorkspace,
  withDatabase,
} from "./helpers";

test.describe("reaching the app", () => {
  test("visitors are sent to sign in, keeping where they were going", async ({
    page,
  }) => {
    await page.goto("/app/some-team/development/agents");
    await expect(page).toHaveURL(
      "/login?next=%2Fapp%2Fsome-team%2Fdevelopment%2Fagents",
    );
    await expect(
      page.getByRole("heading", { name: "Sign in to Nodrail" }),
    ).toBeVisible();
  });

  test("the server opens on the product; the website lives elsewhere", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login?next=%2Fapp");
    for (const path of ["/pricing", "/docs/rules", "/llms.txt"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe(`https://nodrail.com${path}`);
    }
  });
});

test.describe("signing up", () => {
  test("from email to a working workspace", async ({ page, context }) => {
    await signIn(page, newEmail(), "/signup");
    await expect(page).toHaveURL("/app/new");
    await expectAccessible(page);

    await createWorkspace(page, "Northwind Labs");
    await expect(page).toHaveURL("/app/northwind-labs/development/overview");
    await expect(
      page.getByRole("heading", { name: "Overview", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "First steps" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.reload();
    await expect(page).toHaveURL("/app/northwind-labs/development/overview");

    const session = (await context.cookies()).filter(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(session).toEqual([
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
      }),
    ]);
    expect(await page.evaluate(() => document.cookie)).not.toContain(
      SESSION_COOKIE,
    );
  });

  test("an empty workspace name is refused by the form", async ({ page }) => {
    await signIn(page);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page).toHaveURL("/app/new");
  });

  test("the same name gets its own address", async ({ browser }) => {
    const name = `Duplicate ${Date.now()}`;
    const first = await (await browser.newContext()).newPage();
    await startWorkspace(first, name);
    const second = await (await browser.newContext()).newPage();
    await startWorkspace(second, name);
    expect(new URL(second.url()).pathname).not.toBe(
      new URL(first.url()).pathname,
    );
  });
});

test.describe("the sign-in link", () => {
  test("an email scanner fetching it does not use it up", async ({
    page,
    request,
  }) => {
    const email = newEmail();
    await requestLink(page, email);
    const { url } = await signInLink(email);
    expect((await request.get(url)).status()).toBe(200);
    await page.goto(url);
    await page.getByRole("button", { name: "Continue to Nodrail" }).click();
    await expect(page).toHaveURL("/app/new");
  });

  test("works once", async ({ page, browser }) => {
    const email = newEmail();
    await requestLink(page, email);
    const { url } = await signInLink(email);
    await page.goto(url);
    await page.getByRole("button", { name: "Continue to Nodrail" }).click();
    await expect(page).toHaveURL("/app/new");

    const other = await (await browser.newContext()).newPage();
    await setAuthSource(other);
    await other.goto(url);
    await other.getByRole("button", { name: "Continue to Nodrail" }).click();
    await expect(
      other
        .getByRole("alert")
        .filter({ hasText: "expired or was already used" }),
    ).toBeVisible();
  });

  test("an incomplete link explains itself", async ({ page }) => {
    await page.goto("/auth/confirm");
    await expect(
      page.getByRole("heading", { name: "This link is incomplete" }),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test("the answer does not reveal who has an account", async ({ page }) => {
    const existing = newEmail();
    await signIn(page, existing);
    const fresh = await page.context().browser()?.newContext();
    const other = await fresh?.newPage();
    if (!other) throw new Error("no page");
    await requestLink(other, existing);
    const known = await other.getByRole("status").textContent();
    await requestLink(other, newEmail());
    await expect(other.getByRole("status")).toHaveText(known ?? "");
  });

  test("returns people to where they were going", async ({ page }) => {
    const { email, base } = await startWorkspace(page, `Return ${Date.now()}`);
    const target = `${base}/agents`;
    await signOut(page);

    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?next=/);
    const previous = await requestLink(page, email, page.url());
    const { url } = await signInLink(email, previous);
    await page.goto(url);
    await page.getByRole("button", { name: "Continue to Nodrail" }).click();
    await expect(page).toHaveURL(target);
  });

  test("a hostile return address is ignored", async ({ page }) => {
    await signIn(page, newEmail(), "/login?next=//evil.example/app");
    await expect(page).toHaveURL("/app/new");
  });

  test("the form reports an invalid address", async ({ page }) => {
    await page.goto("/auth/link");
    await page.getByLabel("Email", { exact: true }).fill("a@b");
    await page.getByRole("button", { name: /link/i }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "valid email" }),
    ).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe("sessions", () => {
  test("signing out ends access, even with the old cookies", async ({
    page,
    browser,
    context,
  }) => {
    await startWorkspace(page, `Sign out ${Date.now()}`);
    const target = page.url();
    const stolen = await context.cookies();

    await signOut(page);
    await page.goto(target);
    await expect(page).toHaveURL(/\/login/);

    const thief = await browser.newContext();
    await thief.addCookies(stolen);
    const thiefPage = await thief.newPage();
    await thiefPage.goto(target);
    await expect(thiefPage).toHaveURL(/\/login/);
  });

  test("a session closed on the server stops working at once", async ({
    page,
  }) => {
    const { email } = await startWorkspace(page, `Revoked ${Date.now()}`);
    await withDatabase((client) =>
      client.query(
        `UPDATE nodrail.human_sessions s SET revoked_at = now()
         FROM nodrail.users u
         WHERE u.id = s.user_id AND u.verified_email = $1`,
        [email],
      ),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });

  test("a suspended person is locked out", async ({ page }) => {
    const { email } = await startWorkspace(page, `Suspended ${Date.now()}`);
    await withDatabase((client) =>
      client.query(
        `UPDATE nodrail.users SET status = 'suspended' WHERE verified_email = $1`,
        [email],
      ),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
  });

  test("an expired session requires sign-in and is replaced on return", async ({
    page,
    context,
  }) => {
    const { email, base } = await startWorkspace(page, `Expiry ${Date.now()}`);
    const target = `${base}/agents`;
    const login = `/login?next=${encodeURIComponent(target)}`;
    const session = async () =>
      (await context.cookies()).find(
        (cookie) => cookie.name === SESSION_COOKIE,
      );
    const previousSession = await session();
    if (!previousSession) throw new Error("No session cookie");

    const expired = await withDatabase((client) =>
      client.query(
        `UPDATE nodrail.human_sessions SET expires_at = clock_timestamp()
         WHERE token_digest = $1`,
        [tokenDigest(previousSession.value)],
      ),
    );
    expect(expired.rowCount).toBe(1);

    await page.goto(target);
    await expect(page).toHaveURL(login);
    const previous = await requestLink(page, email, page.url());
    await page.goto((await signInLink(email, previous)).url);
    await page.getByRole("button", { name: "Continue to Nodrail" }).click();
    await expect(page).toHaveURL(target);
    await expect(
      page.getByRole("heading", { name: "Agents", level: 1 }),
    ).toBeVisible();

    const replacement = await session();
    expect(replacement?.httpOnly).toBe(true);
    expect(replacement?.value).not.toBe(previousSession.value);
    await context.addCookies([previousSession]);
    await page.reload();
    await expect(page).toHaveURL(login);
  });

  test("signed-in people skip the sign-in page", async ({ page }) => {
    await signIn(page);
    await page.goto("/login");
    await expect(page).toHaveURL("/app/new");
  });

  test("returning people go straight to their workspace", async ({ page }) => {
    await signIn(page);
    const name = `Returning ${Date.now()}`;
    await createWorkspace(page, name);
    const home = page.url();
    await page.goto("/app");
    await expect(page).toHaveURL(home);
  });
});

test.describe("workspace boundaries", () => {
  test("another team's workspace looks like it does not exist", async ({
    page,
    browser,
  }) => {
    await startWorkspace(page, `Private ${Date.now()}`);
    const target = page.url();

    const stranger = await (await browser.newContext()).newPage();
    await signIn(stranger);
    await stranger.goto(target);
    await expect(
      stranger.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
    await expect(stranger.getByText("Private")).toHaveCount(0);
    await expectAccessible(stranger);
  });

  test("unknown sections and environments are not found", async ({ page }) => {
    await startWorkspace(page, `Paths ${Date.now()}`);
    const base = new URL(page.url()).pathname.replace(/\/development.*/, "");
    for (const path of [
      `${base}/staging/overview`,
      `${base}/development/billing`,
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "We can't find that page" }),
      ).toBeVisible();
    }
  });
});

test.describe("the app shell", () => {
  test("every destination opens and marks itself current", async ({ page }) => {
    await startWorkspace(page, `Navigation ${Date.now()}`);
    for (const label of ["Agents", "Policies", "Activity", "Overview"]) {
      // Exact: the first steps also link to some, as "Connect an agent".
      const link = page.getByRole("link", { name: label, exact: true });
      await link.click();
      await expect(
        page.getByRole("heading", { name: label, level: 1 }),
      ).toBeVisible();
      await expect(link).toHaveAttribute("aria-current", "page");
    }
    await expectAccessible(page);
  });

  test("switching environment keeps the page", async ({ page }) => {
    await startWorkspace(page, `Environments ${Date.now()}`);
    await page.getByRole("link", { name: "Agents" }).click();
    await page.waitForURL(/\/agents$/);
    await page.locator("[data-slot=workspace-menu] > summary").click();
    await page.getByRole("link", { name: "Production" }).click();
    await expect(page).toHaveURL(/\/production\/agents$/);
    await expect(page.locator("[data-slot=environment-context]")).toHaveText(
      "Production",
    );
  });

  test("the workspace menu opens its settings, outside any environment", async ({
    page,
  }) => {
    await startWorkspace(page, `Settings ${Date.now()}`);
    await page.locator("[data-slot=workspace-menu] > summary").click();
    await expect(page.locator("[data-slot=plan-badge]")).toHaveText("Free");
    await page.getByRole("link", { name: /Billing & usage/ }).click();
    await page.waitForURL(/\/settings\/billing$/);
    await expect(
      page.getByRole("heading", { name: "Billing & usage", level: 1 }),
    ).toBeVisible();
    const submenu = page.getByRole("navigation", {
      name: "Workspace settings",
    });
    await submenu.getByRole("link", { name: "Members" }).click();
    await page.waitForURL(/\/settings\/members$/);
    await expect(
      submenu.getByRole("link", { name: "Members" }),
    ).toHaveAttribute("aria-current", "page");
    // The sidebar still works in the default environment.
    await page.getByRole("link", { name: "Agents" }).click();
    await page.waitForURL(/\/development\/agents$/);
    await expectAccessible(page);
  });

  test("the account menu opens your own pages", async ({ page }) => {
    await startWorkspace(page, `Yours ${Date.now()}`);
    await page.getByLabel(/your account/i).click();
    await page.getByRole("link", { name: "API tokens" }).click();
    await page.waitForURL(/\/account\/tokens$/);
    await expect(
      page.getByRole("heading", { name: "API tokens", level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Your account" })
        .getByRole("link", { name: "Privacy & your data" }),
    ).toBeVisible();
  });

  test("old Settings and Team addresses move for good", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Moved ${Date.now()}`);
    for (const [from, to] of [
      [`${base}/settings`, `/app/${slug}/settings/general`],
      [`${base}/settings?billing=success`, `/app/${slug}/settings/billing`],
      [`${base}/team`, `/app/${slug}/settings/members`],
    ] as const) {
      const response = await page.request.get(from, { maxRedirects: 0 });
      expect(response.status(), from).toBe(308);
      expect(
        new URL(response.headers().location ?? "", "http://x").pathname,
      ).toBe(to);
    }
  });

  test("the owner is shown as owner, with their email", async ({ page }) => {
    const { email } = await startWorkspace(page, `Account ${Date.now()}`);
    await page.getByLabel(/your account/i).click();
    await expect(page.locator("[data-slot=account-role]")).toHaveText("Owner");
    await expect(page.locator("[data-slot=account-menu] small")).toHaveText(
      email,
    );
  });

  test("a teammate with a role sees that role", async ({ page, browser }) => {
    const { slug } = await startWorkspace(page, `Roles ${Date.now()}`);
    const teammate = await addTeammate(browser, slug, "policy_manager");
    await teammate.page.goto(`/app/${slug}`);
    await teammate.page.waitForURL(/\/overview$/);
    await teammate.page.getByLabel(/your account/i).click();
    await expect(teammate.page.locator("[data-slot=account-role]")).toHaveText(
      "Policy manager",
    );
  });
});
