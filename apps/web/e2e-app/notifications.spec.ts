import { expect, test } from "@playwright/test";
import { connected, runHook, server, shell } from "./hook";
import {
  addTeammate,
  expectAccessible,
  mailTo,
  newEmail,
  requestLink,
  setLastSeen,
  signInLink,
  startWorkspace,
  waitForMail,
  workspacePage,
} from "./helpers";

const deliverUrl = `${server}/api/internal/notifications/deliver`;
const authorized = { authorization: "Bearer local-e2e-secret" };

test.describe("email", () => {
  test("a denied action asks nobody: no email is sent", async ({
    page,
    request,
  }) => {
    const { email, env } = await connected(page, "Mail");
    await runHook(shell("curl https://example.test/TOP-SECRET"), env);
    await request.post(deliverUrl, { headers: authorized });
    const mail = await mailTo(email);
    expect(mail.map((item) => item.Subject).join()).not.toMatch(
      /permission|decision|request/,
    );
    expect(JSON.stringify(mail)).not.toContain("TOP-SECRET");
  });

  test("someone who turned alerts off hears nothing", async ({
    page,
    request,
  }) => {
    const { email, env, base, slug } = await connected(page, "Off");
    await page.goto(workspacePage(base, "account/notifications"));
    await page
      .getByRole("checkbox", { name: /Integration stops reporting/ })
      .uncheck();
    await page.getByRole("button", { name: "Save changes" }).last().click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();

    await runHook({ hook_event_name: "SessionStart" }, env);
    await setLastSeen(slug, "coder", 45);
    await request.post(deliverUrl, { headers: authorized });
    const subjects = (await mailTo(email)).map((item) => item.Subject);
    expect(subjects.join()).not.toContain("stopped reporting");
  });

  test("an invite arrives by email and works", async ({ page, browser }) => {
    const { base } = await startWorkspace(page, `Invite ${Date.now()}`);
    const email = newEmail();
    await page.goto(workspacePage(base, "settings/members"));
    await page.getByRole("button", { name: "Invite teammate" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create invite link" }).click();
    await expect(
      page.getByRole("heading", { name: "Invite sent" }),
    ).toBeVisible();
    await expectAccessible(page);

    const mail = await waitForMail(email, /invited you to/);
    const link = /Join the workspace: (\S+)/.exec(mail.Text)?.[1] ?? "";
    const guest = await (await browser.newContext()).newPage();
    await guest.goto(link);
    await guest.waitForURL(/\/login/);
    const { pathname, search } = new URL(guest.url());
    await requestLink(guest, email, pathname + search);
    await guest.goto((await signInLink(email)).url);
    await guest.getByRole("button", { name: "Continue to Nodrail" }).click();
    await guest.getByRole("button", { name: /^Join / }).click();
    await guest.waitForURL(/\/overview$/);
    await guest.context().close();
  });

  test("an integration that goes silent raises one alert", async ({
    page,
    request,
  }) => {
    const { email, slug, env } = await connected(page, "Silent");
    await runHook({ hook_event_name: "SessionStart" }, env);
    await setLastSeen(slug, "coder", 45);
    await request.post(deliverUrl, { headers: authorized });
    await request.post(deliverUrl, { headers: authorized });
    const mail = await waitForMail(email, /coder stopped reporting/);
    expect(mail.Text).toContain("/agents/coder");
    const alerts = (await mailTo(email)).filter((item) =>
      /stopped reporting/.test(item.Subject),
    );
    expect(alerts).toHaveLength(1);
  });

  test("delivery can only be triggered with the secret", async ({
    request,
  }) => {
    expect((await request.post(deliverUrl)).status()).toBe(401);
    expect(
      (
        await request.post(deliverUrl, {
          headers: { authorization: "Bearer wrong" },
        })
      ).status(),
    ).toBe(401);
    expect(
      (await request.post(deliverUrl, { headers: authorized })).status(),
    ).toBe(200);
  });

  test("the daily Vercel cron calls it with GET and its own secret", async ({
    request,
  }) => {
    expect((await request.get(deliverUrl)).status()).toBe(401);
    const cron = { authorization: "Bearer local-e2e-cron-secret" };
    expect((await request.get(deliverUrl, { headers: cron })).status()).toBe(
      200,
    );
  });
});

test.describe("settings", () => {
  test("offer only what the role can receive", async ({ page, browser }) => {
    const { base, slug } = await startWorkspace(page, `Prefs ${Date.now()}`);
    const viewer = await addTeammate(browser, slug, "viewer");
    await viewer.page.goto(workspacePage(base, "account/notifications"));
    await expect(
      viewer.page.getByText("Your role doesn't receive notifications."),
    ).toBeVisible();
    await expect(viewer.page.getByRole("checkbox")).toHaveCount(0);

    const manager = await addTeammate(browser, slug, "policy_manager");
    await manager.page.goto(workspacePage(base, "account/notifications"));
    await expect(manager.page.getByRole("checkbox")).toHaveCount(1);
    await viewer.page.context().close();
    await manager.page.context().close();
  });
});
