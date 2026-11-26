import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  addTeammate,
  assignAgent,
  confirm,
  connect,
  connectedWorkspace,
  expectAccessible,
  expectFitsPhone,
  newEmail,
  openRowMenu,
  requestLink,
  rowAction,
  seedDecision,
  signIn,
  signInLink,
  startWorkspace,
  workspacePage,
  workspaceWithDecision,
} from "./helpers";

const memberRow = (page: Page, text: string) =>
  page.locator("[data-slot=data-table] tbody tr").filter({ hasText: text });

async function createInviteLink(
  page: Page,
  base: string,
  email: string,
  role = "viewer",
) {
  await page.goto(workspacePage(base, "settings/members"));
  await page.getByRole("button", { name: "Invite teammate" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role").selectOption(role);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = page.getByLabel("Invite link", { exact: true });
  await expect(link).toBeVisible();
  const url = (await link.textContent()) ?? "";
  await expectAccessible(page);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(link).toBeHidden();
  return url;
}

const expectInviteGone = (page: Page) =>
  expect(
    page.getByRole("heading", { name: "This invite is no longer available" }),
  ).toBeVisible();

async function newBrowserPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

async function joinWith(page: Page, url: string, email: string) {
  await page.goto(url);
  await page.waitForURL(/\/login/);
  await requestLink(
    page,
    email,
    new URL(page.url()).pathname + new URL(page.url()).search,
  );
  const { url: confirmUrl } = await signInLink(email);
  await page.goto(confirmUrl);
  await page.getByRole("button", { name: "Continue to Nodrail" }).click();
  await page.waitForURL(/\/invite\//);
}

async function changeRole(page: Page, name: string, role: string) {
  await rowAction(page, memberRow(page, name), "Change role…");
  await page.getByRole("dialog").getByLabel("Role").selectOption(role);
  await page.getByRole("button", { name: "Save role" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

test.describe("invitations", () => {
  test("a new person joins through a link with the invited role", async ({
    page,
    browser,
  }) => {
    const { base } = await startWorkspace(page, `Join ${Date.now()}`);
    const email = newEmail();
    const url = await createInviteLink(page, base, email, "policy_manager");
    await expect(page.locator("[data-slot=invite-list]")).toContainText(email);
    await expect(page.getByText("1 open invite")).toBeVisible();

    const guest = await newBrowserPage(browser);
    await joinWith(guest, url, email);
    await expect(
      guest.getByText(/invited you as Policy manager/),
    ).toBeVisible();
    await expectAccessible(guest);
    await guest.getByRole("button", { name: /^Join / }).click();
    await guest.waitForURL(/\/overview$/);
    await expect(
      guest.getByRole("heading", { name: "First steps" }),
    ).toBeVisible();
    await expect(
      guest.getByRole("link", { name: "Connect a project" }),
    ).toBeVisible();

    await page.goto(workspacePage(base, "settings/members"));
    await expect(memberRow(page, email.split("@")[0] ?? "")).toContainText(
      "Policy manager",
    );
    // A new person is named by their email, shown once, never by an ID.
    await expect(
      memberRow(page, email).getByText(email, { exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText("open invite")).toHaveCount(0);

    await guest.goto(url);
    await expectInviteGone(guest);
    await guest.context().close();
  });

  test("the link is refused for a different address", async ({
    page,
    browser,
  }) => {
    const { base } = await startWorkspace(page, `Wrong ${Date.now()}`);
    const url = await createInviteLink(page, base, newEmail());
    const other = await newBrowserPage(browser);
    await signIn(other);
    await other.goto(url);
    await expect(
      other.getByRole("heading", {
        name: "This invite is for another address",
      }),
    ).toBeVisible();
    await expect(other.getByRole("button", { name: /^Join / })).toHaveCount(0);
    await other.context().close();
  });

  test("a revoked link stops working", async ({ page, browser }) => {
    const { base } = await startWorkspace(page, `Revoke ${Date.now()}`);
    const email = newEmail();
    const url = await createInviteLink(page, base, email);
    await confirm(page, "Revoke", "Revoke invite");
    await expect(page.getByText("open invite")).toHaveCount(0);
    const guest = await newBrowserPage(browser);
    await signIn(guest, email);
    await guest.goto(url);
    await expectInviteGone(guest);
    await guest.context().close();
  });

  test("a bad address and a duplicate explain themselves", async ({ page }) => {
    const { base, email: mine } = await startWorkspace(
      page,
      `Dup ${Date.now()}`,
    );
    const email = newEmail();
    await createInviteLink(page, base, email);
    await page.getByRole("button", { name: "Invite teammate" }).click();
    const dialog = page.getByRole("dialog");
    for (const taken of [email, mine]) {
      await dialog.getByLabel("Email").fill(taken);
      await dialog.getByRole("button", { name: "Create invite link" }).click();
      await expect(dialog.getByRole("alert")).toContainText(
        "already on the team or has an open invite",
      );
      await expect(dialog.getByLabel("Email")).toHaveValue(taken);
    }
  });
});

test.describe("managing people", () => {
  test("a role change takes effect for that person at once", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await workspaceWithDecision(page, "Role change");
    const teammate = await addTeammate(browser, slug, "policy_manager");
    await teammate.page.goto(`${base}/policies`);
    const newRule = teammate.page.getByRole("link", {
      name: /new rule|create rule/i,
    });
    await expect(newRule).toHaveCount(1);

    await page.goto(workspacePage(base, "settings/members"));
    await changeRole(page, teammate.email.split("@")[0] ?? "", "viewer");
    await expect(page.getByText("Role updated.")).toBeVisible();

    await teammate.page.reload();
    await expect(newRule).toHaveCount(0);
    await teammate.page.context().close();
  });

  test("removing someone ends their access", async ({ page, browser }) => {
    const { base, slug } = await startWorkspace(page, `Remove ${Date.now()}`);
    const teammate = await addTeammate(browser, slug, "viewer");
    await teammate.page.goto(`${base}/overview`);
    await expect(
      teammate.page.getByRole("heading", { level: 1, name: "Overview" }),
    ).toBeVisible();

    await page.goto(workspacePage(base, "settings/members"));
    await rowAction(
      page,
      memberRow(page, teammate.email.split("@")[0] ?? ""),
      "Remove…",
    );
    await page.getByRole("button", { name: "Remove teammate" }).click();
    await expect(page.getByText("Teammate removed.")).toBeVisible();

    const response = await teammate.page.goto(`${base}/overview`);
    expect(response?.status()).toBe(404);
    await teammate.page.context().close();
  });

  test("ownership moves only to an admin, and the controls follow", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Owner ${Date.now()}`);
    const teammate = await addTeammate(browser, slug, "policy_manager");
    const name = teammate.email.split("@")[0] ?? "";
    await page.goto(workspacePage(base, "settings/members"));
    const menu = await openRowMenu(page, memberRow(page, name));
    await expect(
      menu.getByRole("menuitem", { name: "Make owner…" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await changeRole(page, name, "admin");
    await rowAction(page, memberRow(page, name), "Make owner…");
    await page.getByRole("button", { name: "Transfer ownership" }).click();
    await expect(page.getByText("Ownership transferred.")).toBeVisible();
    await expect(memberRow(page, name)).toContainText("Owner");
    const after = await openRowMenu(page, memberRow(page, name));
    await expect(
      after.getByRole("menuitem", { name: "Change role…" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await teammate.page.context().close();
  });

  test("assigning an agent shows it to that person", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await connectedWorkspace(page, "Assign");
    const teammate = await addTeammate(browser, slug, "viewer");
    await teammate.page.goto(`${base}/agents/support`);
    await expect(
      teammate.page.getByRole("heading", { level: 1, name: "support" }),
    ).toHaveCount(0);

    await page.goto(`${base}/agents/support/settings`);
    await page.getByLabel("Add a person").selectOption({ index: 0 });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Agent assigned.")).toBeVisible();
    await expectAccessible(page);

    await teammate.page.goto(`${base}/agents/support`);
    await expect(
      teammate.page.getByRole("heading", { level: 1, name: "support" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Unassign" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Unassign" })
      .click();
    await expect(page.getByText("Agent unassigned.")).toBeVisible();
    await teammate.page.goto(`${base}/agents/support`);
    await expect(
      teammate.page.getByRole("heading", { level: 1, name: "support" }),
    ).toHaveCount(0);
    await teammate.page.context().close();
  });

  test("team changes appear in Activity", async ({ page, browser }) => {
    const { base, slug } = await startWorkspace(page, `Audit ${Date.now()}`);
    const teammate = await addTeammate(browser, slug, "viewer");
    const name = teammate.email.split("@")[0] ?? "";
    await page.goto(workspacePage(base, "settings/members"));
    await changeRole(page, name, "policy_manager");
    await page.goto(`${base}/activity?kind=changes`);
    const row = memberRow(page, name);
    await expect(row).toContainText("Role changed");
    await expect(row).toContainText("viewer → policy_manager");
    await teammate.page.context().close();
  });
});

test.describe("settings", () => {
  test("an admin renames the workspace and links keep working", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Rename ${Date.now()}`);
    await page.goto(workspacePage(base, "settings/general"));
    await expectAccessible(page);
    await page.getByLabel("Workspace name").fill("A better name");
    await page.getByLabel("Default environment").selectOption("production");
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.getByText("Workspace saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Workspace name")).toHaveValue(
      "A better name",
    );
    await expect(page.getByLabel("Default environment")).toHaveValue(
      "production",
    );
    await page.goto(base.replace("/development", ""));
    await page.waitForURL(/\/production\/overview$/);
  });

  test("notification choices belong to each person", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Prefs ${Date.now()}`);
    const teammate = await addTeammate(browser, slug, "policy_manager");
    await teammate.page.goto(workspacePage(base, "account/notifications"));
    const choice = teammate.page.getByRole("checkbox", {
      name: /Integration stops reporting/,
    });
    await expect(choice).toBeChecked();
    await choice.uncheck();
    await teammate.page.getByRole("button", { name: "Save changes" }).click();
    await expect(teammate.page.getByText("Preferences saved.")).toBeVisible();
    await teammate.page.reload();
    await expect(choice).not.toBeChecked();

    await page.goto(workspacePage(base, "account/notifications"));
    await expect(
      page.getByRole("checkbox", { name: /Integration stops reporting/ }),
    ).toBeChecked();
    await teammate.page.context().close();
  });

  test("an empty name is refused and keeps the form", async ({ page }) => {
    const { base } = await startWorkspace(page, `Empty ${Date.now()}`);
    await page.goto(workspacePage(base, "settings/general"));
    await page.getByLabel("Workspace name").fill("   ");
    await page.getByRole("button", { name: "Save changes" }).first().click();
    await expect(page.locator("[data-slot=field-error]")).toContainText(
      "workspace name",
    );
    await expect(page.getByLabel("Workspace name")).toHaveValue("   ");
  });
});

const SECTIONS = [
  "overview",
  "agents",
  "policies",
  "activity",
  "activity?view=runs",
  "insights",
];

/** Settings and account pages everyone can open, in no environment. */
const WORKSPACE_PAGES = [
  "settings/general",
  "settings/members",
  "account/notifications",
  "account/tokens",
  "account/privacy",
];

type Expected = {
  agents: string[];
  writeRules: boolean;
  standalone: boolean;
  invite: boolean;
  editWorkspace: boolean;
};

const everyAgent = ["hidden", "mine"];

const matrix: [string, string | null, Expected][] = [
  [
    "owner",
    null,
    {
      agents: everyAgent,
      writeRules: true,
      standalone: true,
      invite: true,
      editWorkspace: true,
    },
  ],
  [
    "admin",
    "admin",
    {
      agents: everyAgent,
      writeRules: true,
      standalone: true,
      invite: true,
      editWorkspace: true,
    },
  ],
  [
    "policy manager",
    "policy_manager",
    {
      agents: everyAgent,
      writeRules: true,
      standalone: false,
      invite: false,
      editWorkspace: false,
    },
  ],
  [
    "viewer",
    "viewer",
    {
      agents: ["mine"],
      writeRules: false,
      standalone: false,
      invite: false,
      editWorkspace: false,
    },
  ],
];

/** Settings and account pages open; billing and data only for who manages. */
async function expectWorkspacePages(
  person: Page,
  base: string,
  manages: boolean,
) {
  for (const path of WORKSPACE_PAGES) {
    const response = await person.goto(workspacePage(base, path));
    expect(response?.status(), path).toBe(200);
  }
  for (const path of ["settings/billing", "settings/data"]) {
    const response = await person.goto(workspacePage(base, path));
    expect(response?.status(), path).toBe(manages ? 200 : 404);
  }
}

test.describe("what each role sees", () => {
  for (const [label, role, expected] of matrix)
    test(`${label}`, async ({ page, browser }) => {
      const { base, slug } = await connectedWorkspace(page, label, "mine");
      await connect(page, base, "hidden");
      await seedDecision(slug, "mine");
      await seedDecision(slug, "hidden");

      let person = page;
      if (role) {
        const teammate = await addTeammate(browser, slug, role);
        await assignAgent(slug, "mine", teammate.email);
        person = teammate.page;
      }

      for (const section of SECTIONS) {
        const response = await person.goto(`${base}/${section}`);
        expect(response?.status(), section).toBe(200);
      }
      await expectWorkspacePages(person, base, expected.editWorkspace);

      await person.goto(`${base}/agents`);
      for (const key of everyAgent) {
        const link = person.getByRole("link", {
          name: new RegExp(`^.?\\s*${key}`),
        });
        if (expected.agents.includes(key)) await expect(link).toBeVisible();
        else await expect(link).toHaveCount(0);
      }
      const connectProject = person.getByRole("link", {
        name: "Connect a project",
      });
      await expect(connectProject).toHaveCount(expected.writeRules ? 1 : 0);
      if (expected.writeRules) {
        await connectProject.click();
        await expect(person).toHaveURL(/\/agents\/connect$/);
        await expect(
          person.getByText("Standalone plugin, manual hook or SDK", {
            exact: true,
          }),
        ).toHaveCount(expected.standalone ? 1 : 0);
      }

      // Each agent this person sees has its decision on Overview; nothing
      // waits for anyone to decide.
      await person.goto(`${base}/overview`);
      await expect(person.locator("[data-slot=decision-row]")).toHaveCount(
        expected.agents.length,
      );
      await expect(
        person.getByRole("button", { name: "Allow once" }),
      ).toHaveCount(0);

      await person.goto(`${base}/policies`);
      await expect(
        person.getByRole("link", { name: /new rule|create rule/i }),
      ).toHaveCount(expected.writeRules ? 1 : 0);

      // The hidden agent's connection, and its denied call.
      await person.goto(`${base}/activity`);
      await expect(
        person
          .locator("[data-slot=data-table] tbody tr")
          .filter({ hasText: "hidden" }),
      ).toHaveCount(expected.agents.includes("hidden") ? 2 : 0);

      await person.goto(workspacePage(base, "settings/members"));
      await expect(
        person.getByRole("button", { name: "Invite teammate" }),
      ).toHaveCount(expected.invite ? 1 : 0);

      await person.goto(workspacePage(base, "settings/general"));
      await expect(person.getByLabel("Workspace name")).toHaveCount(
        expected.editWorkspace ? 1 : 0,
      );

      await expectAccessible(person);
      if (person !== page) await person.context().close();
    });
});

test.describe("on a phone", () => {
  test("settings and account pages fit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { base } = await startWorkspace(page, `Phone ${Date.now()}`);
    for (const path of [...WORKSPACE_PAGES, "settings/billing"]) {
      await page.goto(workspacePage(base, path));
      await expectFitsPhone(page);
      await expectAccessible(page);
    }
  });
});
