import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { runHook, server, shell } from "./hook";
import {
  addTeammate,
  assignAgent,
  confirm,
  connect,
  expectAccessible,
  expectCopied,
  openStandaloneSetup,
  seedDecision,
  setLastSeen,
  startWorkspace,
  withDatabase,
} from "./helpers";

const secretPattern = /^ndr_[0-9a-f]{12}_[\w-]{43}$/;

/** An agent's page, on its first tab or on `tab`: rules, runs or settings. */
const openAgent = (page: Page, base: string, agentKey: string, tab = "") =>
  page.goto(`${base}/agents/${agentKey}${tab ? `/${tab}` : ""}`);

const agentTab = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "Agent sections" })
    .getByRole("link", { name, exact: true });

const badge = (page: Page, text: string) =>
  page.locator("[data-slot=status-badge]", {
    hasText: new RegExp(`^${text}$`),
  });

test.describe("connecting an agent", () => {
  test("from an empty list to a registered agent", async ({ page }) => {
    const { base } = await startWorkspace(page, `Connect ${Date.now()}`);
    await page.goto(`${base}/agents`);
    await expect(
      page.getByRole("heading", { name: "No agents registered yet" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("link", { name: "Connect a project" }).click();
    await page.waitForURL(/\/connect$/);
    await expectAccessible(page);
    await openStandaloneSetup(page);
    await page.getByLabel("TypeScript SDK").check();
    await page.getByLabel("Agent ID").fill("support-agent");
    await page.getByLabel(/Description/).fill("Customer support");
    await page.getByRole("button", { name: "Create credential" }).click();

    const secret = page.getByLabel("Agent credential");
    await expect(secret).toHaveText(secretPattern);
    await expectAccessible(page);

    await page.getByRole("link", { name: "View agent", exact: true }).click();
    await page.waitForURL(/\/agents\/support-agent$/);
    await expect(
      page.getByRole("heading", { name: "support-agent", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Customer support · Development"),
    ).toBeVisible();
    await expect(badge(page, "Waiting for first check-in")).toBeVisible();
    await expect(agentTab(page, "Operations")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("heading", { name: "Operations this agent uses" }),
    ).toBeVisible();
    await agentTab(page, "Settings").click();
    await page.waitForURL(/\/agents\/support-agent\/settings$/);
    await expect(
      page.getByText("TypeScript SDK", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("compatibility to verify")).toHaveCount(0);
    await expectAccessible(page);

    await page.goto(`${base}/agents`);
    const row = page.getByRole("link", { name: /^.?\s*support-agent/ });
    await expect(row).toBeVisible();
    // Never a green "Active" for an agent that never checked in.
    await expect(row).toContainText("Waiting for first check-in");
    await expect(row).toContainText("No check-in yet");
    await expect(row).not.toContainText("Active");
    await expect(page.getByText("1 connected installation")).toBeVisible();
  });

  test("three steps, then the first check-in shows live", async ({ page }) => {
    const { base } = await startWorkspace(page, `Live ${Date.now()}`);
    await page.goto(`${base}/agents/connect`);
    await openStandaloneSetup(page);
    const steps = page.locator("[data-slot=connect-step]");
    await expect(steps).toHaveCount(3);
    await expect(steps.nth(0)).toContainText("1. Choose its host");
    await expect(steps.nth(2)).toContainText(
      "3. Create a standalone credential",
    );
    const checksHeading = page.getByRole("heading", { name: "Checks to run" });
    await expect(checksHeading).toHaveCount(0);
    await page.getByLabel("Agent ID").fill("live");
    await page.getByRole("button", { name: "Create credential" }).click();
    const secret =
      (await page.getByLabel("Agent credential").textContent()) ?? "";

    const status = page.locator("[data-slot=check-in]");
    await expect(status).toHaveText("Waiting for first check-in…");
    await expect(
      page.getByRole("heading", { name: "Credential created" }),
    ).toBeVisible();
    await expect(checksHeading).toHaveCount(0);
    await expectAccessible(page);

    // The hook asks about an action no rule covers: its first check-in.
    await runHook(shell("ls"), {
      NODRAIL_URL: server,
      NODRAIL_CREDENTIAL: secret,
    });
    await expect(status).toContainText("Checked in", { timeout: 15_000 });
    await expect(
      page.locator("[data-slot=setup-check][data-done]"),
    ).toContainText("An action no rule covers");
    await expect(
      page.getByRole("heading", { name: "live is connected" }),
    ).toBeVisible();
    await status.getByRole("link", { name: "Open Activity" }).click();
    await page.waitForURL(/activity\?agent=live$/);
    await expect(
      page.getByText("Denied · no rule covers it").first(),
    ).toBeVisible();
  });

  test("the secret never appears again", async ({ page }) => {
    const { base } = await startWorkspace(page, `Secret ${Date.now()}`);
    const secret = await connect(page, base, "once");
    await openAgent(page, base, "once", "settings");
    await expect(page.getByText(/^ndr_\w+_…$/)).toBeVisible();
    expect(await page.content()).not.toContain(
      secret.slice(secret.indexOf("_", 4) + 1),
    );
  });

  test("the secret can be copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { base } = await startWorkspace(page, `Copy ${Date.now()}`);
    const secret = await connect(page, base, "copied");
    await expectCopied(page, secret);
  });

  test("a duplicate and a badly formed ID explain themselves", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Errors ${Date.now()}`);
    await connect(page, base, "taken");
    await page.goto(`${base}/agents/connect`);
    await openStandaloneSetup(page);
    const field = page.getByLabel("Agent ID");
    await field.fill("taken");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByText(/already has an installation/)).toBeVisible();
    await expect(field).toHaveValue("taken");

    await field.fill("Not Valid");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByText(/up to 58 lowercase/)).toBeVisible();
    await expectAccessible(page);
  });

  test("a known agent joins another environment", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Envs ${Date.now()}`);
    await connect(page, base, "traveller");

    const production = `/app/${slug}/production`;
    await openAgent(page, production, "traveller");
    await expect(
      page.getByRole("heading", { name: "Not connected in Production" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open setup in Production" }).click();
    await expect(page.getByLabel("Agent ID")).toHaveValue("traveller");
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByLabel("Agent credential")).toBeVisible();

    await openAgent(page, production, "traveller", "settings");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Stops this agent on machines that report it. To contain a machine you don't trust, pause or revoke the machine.",
    );
  });

  test("an agent stays in its own environment's list", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Scoped ${Date.now()}`);
    await connect(page, base, "dev-only");
    await page.goto(`/app/${slug}/production/agents`);
    await expect(
      page.getByRole("heading", { name: "No agents registered yet" }),
    ).toBeVisible();
  });
});

test("project agents and machine access have separate controls", async ({
  page,
}) => {
  const { base, slug } = await startWorkspace(
    page,
    `Project agents ${Date.now()}`,
  );
  await connect(page, base, "desk-machine");
  const project = randomUUID();
  await withDatabase(async (db) => {
    await db.query(
      `UPDATE nodrail.installations i SET enrollment_project_id = $2, enrollment_agent_keys = ARRAY['support', 'marketing']
       FROM nodrail.workspaces w WHERE w.slug = $1 AND i.workspace_id = w.id`,
      [slug, project],
    );
    await db.query(
      `INSERT INTO nodrail.agents (workspace_id, external_key, managed_project_id)
       SELECT w.id, caller, $2 FROM nodrail.workspaces w CROSS JOIN unnest(ARRAY['support', 'marketing']) caller
       WHERE w.slug = $1`,
      [slug, project],
    );
  });

  await page.goto(`${base}/agents`);
  const agents = page.getByRole("list", { name: "Agents", exact: true });
  const row = (name: string) =>
    agents.locator("[data-slot=agent-row]").filter({
      has: page.getByText(name, { exact: true }),
    });
  const support = row("support");
  const marketing = row("marketing");
  for (const agent of [support, marketing]) {
    await expect(agent).toContainText(`from ${project}`);
    await expect(agent.getByRole("list", { name: "Machines" })).toContainText(
      "desk-machine-dev",
    );
  }
  await expect(
    page.getByRole("list", { name: "Unidentified callers" }),
  ).toContainText("Unidentified callers on desk-machine-dev");

  const pause = async (
    button: string,
    scope: "agent" | "machine",
    copy: string,
  ) => {
    await support
      .getByRole("button", { name: `Actions for ${button}`, exact: true })
      .click();
    await page.getByRole("menuitem", { name: /^Pause/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(copy);
    if (scope === "agent")
      await expect(
        dialog.getByRole("link", { name: "Manage machines" }),
      ).toHaveAttribute("href", `${base}/agents#machines`);
    await dialog.getByRole("button", { name: `Pause ${scope}` }).click();
    await expect(dialog).toBeHidden();
  };
  await pause(
    "support",
    "agent",
    "Stops this agent on machines that report it. To contain a machine you don't trust, pause or revoke the machine.",
  );
  await expect(support).toContainText("Paused");
  await expect(marketing).not.toContainText("Paused");

  await pause(
    "desk-machine-dev",
    "machine",
    "from every caller on this machine",
  );
  await expect(marketing.getByRole("list", { name: "Machines" })).toContainText(
    "Paused",
  );
});

test.describe("an agent's tabs", () => {
  test("each tab has its own address", async ({ page }) => {
    const { base } = await startWorkspace(page, `Tabs ${Date.now()}`);
    await connect(page, base, "tabbed");
    await openAgent(page, base, "tabbed");
    await expect(agentTab(page, "Operations")).toHaveAttribute(
      "aria-current",
      "page",
    );

    await agentTab(page, "Rules").click();
    await page.waitForURL(/\/agents\/tabbed\/rules$/);
    await expect(
      page.getByRole("heading", { name: "No rules apply to tabbed" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "New rule for tabbed" }),
    ).toHaveAttribute("href", /\/policies\/new\?agent=tabbed$/);
    await expectAccessible(page);

    await agentTab(page, "Runs").click();
    await page.waitForURL(/\/agents\/tabbed\/runs$/);
    await expect(
      page.getByRole("heading", { name: "No runs for tabbed yet" }),
    ).toBeVisible();
    await expect(agentTab(page, "Runs")).toHaveAttribute(
      "aria-current",
      "page",
    );
    // Pausing is on the Settings tab only, not in the heading.
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toHaveCount(0);
    await expectAccessible(page);

    const missing = await page.goto(`${base}/agents/ghost/runs`);
    expect(missing?.status()).toBe(404);
  });
});

test.describe("reporting", () => {
  test("follows the last check-in", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Report ${Date.now()}`);
    await connect(page, base, "signal");
    await setLastSeen(slug, "signal", 2);
    await openAgent(page, base, "signal", "settings");
    await expect(badge(page, "Reporting")).toBeVisible();
    await expect(page.getByText("2 min ago")).toBeVisible();

    await setLastSeen(slug, "signal", 45);
    await page.reload();
    await expect(badge(page, "Stale")).toBeVisible();
  });
});

test.describe("pausing and resuming", () => {
  test("the dialog is safe by default", async ({ page }) => {
    const { base } = await startWorkspace(page, `Safe ${Date.now()}`);
    await connect(page, base, "careful");
    await openAgent(page, base, "careful", "settings");
    const trigger = page.getByRole("button", { name: "Pause", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Pause careful?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expect(dialog).toContainText(
      "Stops this agent on machines that report it.",
    );
    await expect(dialog).toContainText(
      "calls outside the integration are unaffected",
    );
    await expectAccessible(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(badge(page, "Paused")).toHaveCount(0);
  });

  test("pausing affects this agent only, and resume restores access", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Pause ${Date.now()}`);
    await connect(page, base, "first");
    await connect(page, base, "second");

    await openAgent(page, base, "first", "settings");
    await confirm(page, "Pause", "Pause agent");
    await expect(badge(page, "Paused")).toBeVisible();
    await expect(page.getByText("Agent paused.")).toBeVisible();
    await expect(page.getByText(/^Paused by /)).toBeVisible();

    await page.goto(`${base}/agents`);
    const rows = page.locator("[data-slot=agent-row]");
    // By its name: "Waiting for first check-in" also says "first".
    const named = (name: string) =>
      rows.filter({ has: page.getByText(name, { exact: true }) });
    await expect(named("first")).toContainText("Paused");
    await expect(named("second")).not.toContainText("Paused");
    // Nothing waits for a person, so no row counts requests.
    for (const row of await rows.all())
      await expect(row).not.toContainText(
        /request.* waiting|No current request/,
      );

    await openAgent(page, base, "first");
    await confirm(page, "Resume", "Resume agent");
    await expect(badge(page, "Paused")).toHaveCount(0);
    await expect(page.getByText(/^Paused by /)).toBeHidden();
  });

  test("pausing does not change reporting", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Keep ${Date.now()}`);
    await connect(page, base, "steady");
    await setLastSeen(slug, "steady", 3);
    await openAgent(page, base, "steady", "settings");
    await confirm(page, "Pause", "Pause agent");
    await expect(badge(page, "Reporting")).toBeVisible();
  });
});

test.describe("credentials", () => {
  test("rotating shows a new secret once", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Rotate ${Date.now()}`);
    const original = await connect(page, base, "rotated");
    await seedDecision(slug, "rotated");
    await openAgent(page, base, "rotated", "settings");
    await confirm(page, "Rotate", "Rotate");

    const fresh = page.getByLabel("New credential");
    await expect(fresh).toHaveText(secretPattern);
    expect(await fresh.textContent()).not.toBe(original);

    await page.getByRole("button", { name: "I've saved it" }).click();
    await expect(fresh).toBeHidden();
  });

  test("revoking stops the credential and allows a new one", async ({
    page,
  }) => {
    const { base, slug } = await startWorkspace(page, `Revoke ${Date.now()}`);
    await connect(page, base, "exposed");
    await seedDecision(slug, "exposed");
    await openAgent(page, base, "exposed", "settings");
    await confirm(page, "Revoke", "Revoke credential");

    await expect(page.getByText("no working credential")).toBeVisible();
    await expect(page.getByText("Credential revoked.")).toBeVisible();

    await confirm(page, "Create credential", "Create credential");
    await expect(page.getByLabel("New credential")).toHaveText(secretPattern);
  });
});

test.describe("what each role can do", () => {
  test("a viewer sees only assigned agents and cannot manage them", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Viewer ${Date.now()}`);
    await connect(page, base, "assigned");
    await connect(page, base, "secret-project");
    const viewer = await addTeammate(browser, slug, "viewer");
    await assignAgent(slug, "assigned", viewer.email);

    await viewer.page.goto(`${base}/agents`);
    await expect(
      viewer.page.getByRole("link", { name: /^.?\s*assigned/ }),
    ).toBeVisible();
    await expect(viewer.page.getByText("secret-project")).toHaveCount(0);
    await expect(
      viewer.page.getByText("1 connected installation"),
    ).toBeVisible();
    await expect(
      viewer.page.getByRole("link", { name: "Connect a project" }),
    ).toHaveCount(0);

    await openAgent(viewer.page, base, "assigned", "settings");
    await expect(
      viewer.page.getByRole("heading", { name: "assigned", level: 1 }),
    ).toBeVisible();
    await expect(
      viewer.page.getByRole("button", { name: "Pause" }),
    ).toHaveCount(0);
    await expect(
      viewer.page.getByRole("heading", { name: "Credential" }),
    ).toHaveCount(0);

    const notFound = viewer.page.getByRole("heading", {
      name: "We can't find that page",
    });
    await openAgent(viewer.page, base, "secret-project");
    await expect(notFound).toBeVisible();
    await viewer.page.goto(`${base}/agents/connect`);
    await expect(notFound).toBeVisible();
  });

  test("a policy manager sees everything but cannot manage agents", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Manager ${Date.now()}`);
    await connect(page, base, "visible");
    const manager = await addTeammate(browser, slug, "policy_manager");
    await openAgent(manager.page, base, "visible");
    await expect(
      manager.page.getByRole("heading", { name: "visible", level: 1 }),
    ).toBeVisible();
    await expect(
      manager.page.getByRole("button", { name: "Pause" }),
    ).toHaveCount(0);
  });

  test("an admin who is not the owner can manage agents", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Admin ${Date.now()}`);
    await connect(page, base, "shared");
    const admin = await addTeammate(browser, slug, "admin");
    await openAgent(admin.page, base, "shared", "settings");
    await confirm(admin.page, "Pause", "Pause agent");
    await expect(badge(admin.page, "Paused")).toBeVisible();
    await expect(admin.page.getByText(/^Paused by /)).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("agents fit and work", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Phone ${Date.now()}`);
    await connect(
      page,
      base,
      "a-rather-long-agent-identifier-for-narrow-screens",
    );
    await seedDecision(
      slug,
      "a-rather-long-agent-identifier-for-narrow-screens",
    );
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );

    await page.goto(`${base}/agents`);
    expect(await fits()).toBe(true);
    await expectAccessible(page);
    await openAgent(
      page,
      base,
      "a-rather-long-agent-identifier-for-narrow-screens",
      "settings",
    );
    expect(await fits()).toBe(true);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    expect(await fits()).toBe(true);
    await expectAccessible(page);
  });
});
