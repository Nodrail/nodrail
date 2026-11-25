import { expect, test, type Page } from "@playwright/test";
import {
  addTeammate,
  assignAgent,
  chooseDecision,
  confirm,
  connect,
  connectedWorkspace,
  createRule,
  expectAccessible,
  openRowMenu,
  publishButton,
  rowAction,
  seedDecision,
  startWorkspace,
} from "./helpers";

const deleteIssues = {
  operation: "github.issues.delete",
  resourceKind: "issue",
};

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({ hasText: name });

async function openRule(page: Page, name: string) {
  await row(page, name).getByRole("link", { name, exact: true }).click();
  await page.waitForURL(/\/policies\/[0-9a-f-]{36}$/);
}

test.describe("creating rules", () => {
  test("publishing on a slow computer always opens the rules", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const { base } = await startWorkspace(page, `Slow ${Date.now()}`);
    // At this speed the form once re-rendered itself without end after a
    // publish, so the rules list never opened (use-impact.ts).
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 3 });
    for (let index = 0; index < 8; index += 1)
      await createRule(page, base, {
        name: `Slow ${index}`,
        operation: `github.issues.op${index}`,
        resourceKind: "issue",
      });
    await expect(page.getByRole("row", { name: /Slow 7/ })).toBeVisible();
  });

  test("from an empty page to an active rule", async ({ page }) => {
    const { base } = await startWorkspace(page, `Rules ${Date.now()}`);
    await page.goto(`${base}/policies`);
    await expect(
      page.getByRole("heading", { name: "No rules yet" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByRole("link", { name: "New rule" }).click();
    await page.waitForURL(/\/new$/);
    await expect(
      page.getByText(
        "Applies in Development only. Each environment has its own policies.",
      ),
    ).toBeVisible();
    await expectAccessible(page);

    await page.getByLabel("Rule name").fill("Support reads");
    await page.getByLabel("Operation").fill("github.issues.list");
    await page.getByLabel("Resource type").fill("repository");
    await page.getByLabel("Resource", { exact: true }).fill("acme/support");
    await page.getByRole("button", { name: "Add condition" }).click();
    await page.getByLabel("Parameter").fill("read_only");
    await page.getByLabel("Value").fill("true");

    // No decision is chosen for you, and it says it publishes at once.
    const summary = page.locator("[data-slot=rule-summary]");
    await expect(summary).toHaveText(
      "Choose a decision to see what this rule will do.",
    );
    await publishButton(page).click();
    await expect(page).toHaveURL(/\/new$/);
    await expect(publishButton(page)).toHaveText(
      "Create and publish to Development",
    );
    await chooseDecision(page, "Allow");
    await expect(summary).toHaveText(
      "Allows every agent to run github.issues.list on acme/support when read_only = true in Development, until revoked.",
    );
    await expect(page.locator("[data-slot=policy-impact]")).toHaveText(
      "No actions were recorded in Development in the last 7 days, so there is nothing to compare yet.",
    );
    await expectAccessible(page);
    await publishButton(page).click();

    await page.waitForURL(/\/policies$/);
    await expect(page.getByText("Rule published.")).toBeVisible();
    const created = row(page, "Support reads");
    await expect(created).toContainText(
      "github.issues.list · repository=acme/support",
    );
    await expect(created).toContainText("Allow");
    // Columns that say something: when it last decided, and when it ends.
    await expect(created).toContainText("Not in 90 days");
    await expect(created).toContainText("Never");
    await expect(created).not.toContainText("All agents");
    await expect(page.getByText("1 active rule")).toBeVisible();
    await expectAccessible(page);

    await openRule(page, "Support reads");
    await expect(
      page.getByText("read_only = true", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
    await expectAccessible(page);
  });

  test("a malformed operation is stopped by the form", async ({ page }) => {
    const { base } = await startWorkspace(page, `Invalid ${Date.now()}`);
    await page.goto(`${base}/policies/new`);
    await page.getByLabel("Rule name").fill("Bad");
    await chooseDecision(page, "Allow");
    await page.getByLabel("Operation").fill("no dot here");
    await page.getByLabel("Resource type").fill("repository");
    await page.getByLabel("Resource", { exact: true }).fill("x");
    await publishButton(page).click();
    await expect(page).toHaveURL(/\/new$/);
  });

  test("a rule can be limited to one agent and its installation", async ({
    page,
  }) => {
    const { base } = await connectedWorkspace(page, "Scoped", "scoped-agent");
    await page.goto(`${base}/policies/new`);
    const installation = page.getByLabel("Installation");
    await expect(installation.locator("option")).toHaveCount(1);
    await page.getByLabel("Agent").selectOption("scoped-agent");
    await expect(installation.locator("option")).toHaveCount(2);
    await installation.selectOption("scoped-agent-dev");
    await page.getByLabel("Rule name").fill("One installation");
    await chooseDecision(page, "Deny");
    await page.getByLabel("Operation").fill("github.issues.list");
    await page.getByLabel("Resource type").fill("repository");
    await page.getByLabel("Which resources").selectOption("any");
    await expect(page.locator("[data-slot=rule-summary]")).toHaveText(
      "Denies scoped-agent (installation scoped-agent-dev) github.issues.list on any repository in Development, until revoked.",
    );
    await publishButton(page).click();
    await page.waitForURL(/\/policies$/);
    // A scoped rule names its agent and installation beside its scope.
    await expect(row(page, "One installation")).toContainText(
      "github.issues.list · repository=* · scoped-agent / scoped-agent-dev",
    );
  });

  test("warns about another rule for the same operation", async ({ page }) => {
    const { base } = await startWorkspace(page, `Overlap ${Date.now()}`);
    await createRule(page, base, { name: "First", ...deleteIssues });
    await page.goto(`${base}/policies/new`);
    await page.getByLabel("Operation").fill("github.issues.delete");
    await expect(
      page.getByText(/Another rule shares this operation/),
    ).toContainText("First");
  });
});

test.describe("what a rule would change", () => {
  test("the form offers what was seen and shows what would change", async ({
    page,
  }) => {
    const { base, slug } = await connectedWorkspace(page, "Impact");
    await seedDecision(slug, "support");
    await page.goto(`${base}/policies/new`);
    await expect(
      page.locator("datalist#operation-suggestions option"),
    ).toHaveAttribute("value", "github.issues.delete");
    await page.getByLabel("Rule name").fill("Deletes");
    await chooseDecision(page, "Deny");
    await page.getByLabel("Operation").fill("github.issues.delete");
    await page.getByLabel("Resource type").fill("issue");
    await expect(
      page.locator("datalist#resource-value-suggestions option"),
    ).toHaveAttribute("value", "acme/support#482");
    await page.getByLabel("Which resources").selectOption("any");
    await expect(page.locator("[data-slot=policy-impact]")).toHaveText(
      "Of 1 action in the last 7 days, it would have matched 1; 1 action would have been decided differently.",
    );
    await page.getByLabel("Resource type").fill("repository");
    await expect(page.locator("[data-slot=policy-impact]")).toHaveText(
      "Of 1 action in the last 7 days, it would have matched 0; none would have been decided differently.",
    );
  });

  test("publishing says it published, and closes nothing", async ({ page }) => {
    const { base, slug } = await connectedWorkspace(page, "Publish");
    await seedDecision(slug, "support");
    await createRule(page, base, { name: "Allow deletes", ...deleteIssues });
    await expect(
      page.getByText("Rule published.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/request.*closed/)).toHaveCount(0);
  });
});

test.describe("editing and revoking", () => {
  test("editing keeps the rule and records a new version", async ({ page }) => {
    const { base } = await startWorkspace(page, `Edit ${Date.now()}`);
    await createRule(page, base, { name: "Original", ...deleteIssues });
    await row(page, "Original")
      .getByRole("link", { name: "Edit Original" })
      .click();
    await page.waitForURL(/\/edit$/);
    await expect(page.getByLabel("Operation")).toHaveValue(
      "github.issues.delete",
    );
    await expect(page.getByLabel("Which resources")).toHaveValue("any");
    await expect(
      page.getByRole("radio", { name: "Allow", exact: true }),
    ).toBeChecked();
    await expectAccessible(page);

    await page.getByLabel("Rule name").fill("Renamed");
    await chooseDecision(page, "Deny");
    await expect(publishButton(page)).toHaveText(
      "Save and publish to Development",
    );
    await publishButton(page).click();
    await page.waitForURL(/\/policies$/);
    await expect(row(page, "Renamed")).toContainText("Deny");
    await expect(row(page, "Original")).toHaveCount(0);

    await openRule(page, "Renamed");
    await expect(page.getByText("Version 2")).toBeVisible();
    await expect(page.getByText("Version 1")).toBeVisible();
  });

  test("a second person's stale edit is refused", async ({ page, context }) => {
    const { base } = await startWorkspace(page, `Stale ${Date.now()}`);
    await createRule(page, base, { name: "Shared", ...deleteIssues });
    await row(page, "Shared")
      .getByRole("link", { name: "Edit Shared" })
      .click();
    await page.waitForURL(/\/edit$/);

    const second = await context.newPage();
    await second.goto(page.url());
    await second.getByLabel("Rule name").fill("Second person");
    await publishButton(second).click();
    await second.waitForURL(/\/policies$/);

    await page.getByLabel("Rule name").fill("First person");
    await publishButton(page).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Someone else changed this rule" }),
    ).toBeVisible();
    await expect(page.getByLabel("Rule name")).toHaveValue("First person");
  });

  test("revoking keeps the rule as read-only history", async ({ page }) => {
    const { base } = await startWorkspace(page, `Revoke ${Date.now()}`);
    await createRule(page, base, { name: "Doomed", ...deleteIssues });
    await rowAction(page, row(page, "Doomed"), "Revoke…");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: /^Cancel$/ }),
    ).toBeFocused();
    await expect(dialog).toContainText("github.issues.delete · issue=*");
    await dialog.getByRole("button", { name: "Revoke rule" }).click();

    await expect(row(page, "Doomed")).toContainText("Revoked");
    const menu = await openRowMenu(page, row(page, "Doomed"));
    await expect(menu.getByRole("menuitem")).toHaveText(["View"]);
    await page.keyboard.press("Escape");
    await expect(page.getByText("0 active rules")).toBeVisible();

    await openRule(page, "Doomed");
    await expect(
      page.getByText("Revoked", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
    await page.goto(`${page.url()}/edit`);
    await expect(
      page.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
  });

  test("revoking from the rule's page works too", async ({ page }) => {
    const { base } = await startWorkspace(page, `Detail ${Date.now()}`);
    await createRule(page, base, { name: "From detail", ...deleteIssues });
    await openRule(page, "From detail");
    await confirm(page, "Revoke", "Revoke rule");
    await expect(page.getByText("Rule revoked.")).toBeVisible();
  });
});

test.describe("finding rules", () => {
  test("search, decision and agent filters narrow the list", async ({
    page,
  }) => {
    const { base } = await connectedWorkspace(page, "Filters", "alpha");
    await connect(page, base, "beta");
    await createRule(page, base, {
      name: "Alpha allow",
      agent: "alpha",
      ...deleteIssues,
    });
    await createRule(page, base, {
      name: "Beta deny",
      agent: "beta",
      decision: "Deny",
      operation: "stripe.refunds.create",
      resourceKind: "invoice",
    });
    await createRule(page, base, {
      name: "Everyone archive",
      decision: "Allow",
      operation: "slack.channels.archive",
      resourceKind: "channel",
    });
    await page.goto(`${base}/policies`);

    await page.getByRole("button", { name: "Deny", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Deny", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, "Beta deny")).toBeVisible();
    await expect(row(page, "Alpha allow")).toHaveCount(0);
    await page.getByRole("button", { name: "All", exact: true }).click();

    await page.getByLabel("Search rules").fill("stripe");
    await expect(row(page, "Beta deny")).toBeVisible();
    await expect(row(page, "Alpha allow")).toHaveCount(0);

    await page.getByLabel("Search rules").fill("nothing matches this");
    await expect(page.getByText("No matching rules")).toBeVisible();
    await page.getByLabel("Search rules").fill("");

    await page.getByLabel("Filter by agent").selectOption("alpha");
    await expect(row(page, "Alpha allow")).toBeVisible();
    await expect(row(page, "Everyone archive")).toBeVisible();
    await expect(row(page, "Beta deny")).toHaveCount(0);
  });

  test("the agent page opens its rules", async ({ page }) => {
    const { base } = await connectedWorkspace(page, "Deep", "linked");
    await connect(page, base, "other");
    await createRule(page, base, {
      name: "Linked rule",
      agent: "linked",
      ...deleteIssues,
    });
    await createRule(page, base, {
      name: "Other rule",
      agent: "other",
      operation: "github.issues.list",
      resourceKind: "repository",
    });
    await page.goto(`${base}/agents/linked`);
    await page
      .getByRole("navigation", { name: "Agent sections" })
      .getByRole("link", { name: "Rules", exact: true })
      .click();
    await page.waitForURL(/\/agents\/linked\/rules$/);
    await expect(page.getByText("1 rule for linked")).toBeVisible();
    await expect(page.getByLabel("Filter by agent")).toHaveCount(0);
    await expect(row(page, "Linked rule")).toBeVisible();
    await expect(row(page, "Other rule")).toHaveCount(0);
    await expectAccessible(page);

    // Policies still narrows to one agent from the address.
    await page.goto(`${base}/policies?agent=linked`);
    await expect(page.getByLabel("Filter by agent")).toHaveValue("linked");
    await expect(row(page, "Other rule")).toHaveCount(0);
  });

  test("gates and budgets each have their own tab and action", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Gates ${Date.now()}`);
    await page.goto(`${base}/policies`);
    const tabs = page.getByRole("navigation", { name: "Policies view" });
    await expect(tabs.getByRole("link", { name: "Rules" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const [tab, path, empty, action] of [
      ["Gates", "gates", "No gates yet", "New gate"],
      ["Budgets", "budgets", "No budgets yet", "New budget"],
    ] as const) {
      await tabs.getByRole("link", { name: tab, exact: true }).click();
      await page.waitForURL(new RegExp(`/policies/${path}$`));
      await expect(page.getByRole("heading", { name: empty })).toBeVisible();
      await expect(
        tabs.getByRole("link", { name: tab, exact: true }),
      ).toHaveAttribute("aria-current", "page");
      // One way to add, of this tab's kind; files and copies under More.
      await expect(page.getByRole("link", { name: /^New / })).toHaveText([
        action,
      ]);
      await expect(
        page.getByRole("link", { name: /(Import|Export) YAML/ }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "More policy actions" }).click();
      await expect(page.getByRole("menuitem")).toHaveText([
        "Copy to Production…",
        "Import YAML",
        "Export YAML",
      ]);
      await page.keyboard.press("Escape");
      await expectAccessible(page);
    }
  });

  test("gates and budgets are added, edited and removed in forms", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Gate forms ${Date.now()}`);
    await createRule(page, base, { name: "Visible", ...deleteIssues });
    await page.goto(`${base}/policies/gates`);

    // A gate, from the header.
    await page.getByRole("link", { name: "New gate" }).click();
    await page.waitForURL(/\/policies\/gates\/new$/);
    await expectAccessible(page);
    await page.getByLabel("Gate name").fill("QA before a pull request");
    await page.getByLabel("Operation").fill("github.pr.create");
    await page.getByLabel("Resource type").fill("repository");
    await page.getByLabel("Which resources").selectOption("any");
    await page.getByLabel("Step agent").fill("qa");
    await page.getByLabel("After work by").fill("dev");
    // Names nothing has reported are pointed out, but never block saving.
    await expect(
      page.getByText(
        "No step agent called “qa” has reported in this environment.",
      ),
    ).toBeVisible();
    // Unmet, a gate denies with what is missing: there is nothing to choose.
    await expect(page.getByLabel("While steps are missing")).toHaveCount(0);
    await expect(page.locator("[data-slot=policy-impact]")).toContainText(
      "No actions were recorded in Development",
    );
    await expect(publishButton(page)).toHaveText(
      "Create and publish to Development",
    );
    await publishButton(page).click();
    await page.waitForURL(/\/policies\/gates$/);
    const gates = page.getByRole("main");
    await expect(gates).toContainText("QA before a pull request");
    await expect(gates).toContainText(
      "qa must report pass after the latest change and after any dev step",
    );

    // Edited: the form opens with what was saved.
    await page
      .getByRole("link", { name: "Edit QA before a pull request" })
      .click();
    await page.waitForURL(/\/policies\/gates\/[^/]+\/edit$/);
    await expect(page.getByLabel("Operation")).toHaveValue("github.pr.create");
    await page.getByLabel("Gate name").fill("QA first");
    await publishButton(page).click();
    await page.waitForURL(/\/policies\/gates$/);
    await expect(gates).toContainText("QA first");
    await expect(
      page.getByRole("columnheader", { name: "While steps are missing" }),
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "QA first" }),
    ).toContainText("Deny");

    // A budget, from its own tab. Tokens can only be counted per run.
    await page
      .getByRole("navigation", { name: "Policies view" })
      .getByRole("link", { name: "Budgets", exact: true })
      .click();
    await page.getByRole("link", { name: "New budget" }).click();
    await page.waitForURL(/\/policies\/budgets\/new$/);
    await expectAccessible(page);
    await page.getByLabel("Budget name").fill("Spend per run");
    await page.getByLabel("Counts").selectOption("usd");
    await expect(page.getByLabel("Per")).toHaveValue("run");
    await page.getByLabel("Limit", { exact: true }).fill("5");
    await page.getByLabel("Warn at").fill("9");
    await expect(page.getByLabel("When exceeded")).toHaveCount(0);
    await publishButton(page).click();
    await expect(page.getByText("Warn below the limit.")).toBeVisible();
    await page.getByLabel("Warn at").fill("4");
    await publishButton(page).click();
    await page.waitForURL(/\/policies\/budgets$/);
    const budgets = page.getByRole("main");
    const spend = page.getByRole("row").filter({ hasText: "Spend per run" });
    await expect(spend).toContainText("Spend (USD)");
    await expect(spend).toContainText("USD 5");
    await expect(spend).toContainText("Warns at USD 4");
    await expect(spend).toContainText("Each run");
    await expect(spend).toContainText("Deny");
    // Its recent use: nothing ran yet.
    await expect(spend).toContainText("No runs");
    await expect(budgets).not.toContainText("QA first");

    // Edited from its row, back to the Budgets tab.
    await page.getByRole("link", { name: "Edit Spend per run" }).click();
    await page.waitForURL(/\/policies\/budgets\/[^/]+\/edit$/);
    await expect(page.getByLabel("Warn at")).toHaveValue("4");
    await page.getByLabel("Limit", { exact: true }).fill("6");
    await publishButton(page).click();
    await page.waitForURL(/\/policies\/budgets$/);
    await expect(spend).toContainText("USD 6");

    // The YAML tab shows both.
    await page.goto(`${base}/policies/yaml`);
    const editor = page.getByRole("textbox", { name: "Rules as YAML" });
    await expect(editor).toContainText("gate: QA first");
    await expect(editor).toContainText("budget: Spend per run");

    // Removed after a confirmation; the rule stays.
    await page.goto(`${base}/policies/gates`);
    await rowAction(
      page,
      page.getByRole("row").filter({ hasText: "QA first" }),
      "Remove…",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove gate" })
      .click();
    await expect(gates).not.toContainText("QA first");
    await expect(
      page.getByRole("heading", { name: "No gates yet" }),
    ).toBeVisible();
    await page.goto(`${base}/policies/budgets`);
    await expect(budgets).toContainText("Spend per run");
    await page.goto(`${base}/policies`);
    await expect(row(page, "Visible")).toBeVisible();
  });

  test("each environment has its own rules", async ({ page }) => {
    const { base, slug } = await startWorkspace(page, `Env ${Date.now()}`);
    await createRule(page, base, { name: "Dev only", ...deleteIssues });
    await page.goto(`/app/${slug}/production/policies`);
    await expect(
      page.getByRole("heading", { name: "No rules yet" }),
    ).toBeVisible();
  });
});

test.describe("what each role can do", () => {
  test("a viewer can read rules but not change them", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Viewer ${Date.now()}`);
    await createRule(page, base, { name: "Visible", ...deleteIssues });
    const reader = await addTeammate(browser, slug, "viewer");
    await reader.page.goto(`${base}/policies`);
    await expect(row(reader.page, "Visible")).toBeVisible();
    await expect(
      reader.page.getByRole("link", { name: "New rule" }),
    ).toHaveCount(0);
    const menu = await openRowMenu(reader.page, row(reader.page, "Visible"));
    await expect(menu.getByRole("menuitem")).toHaveText(["View"]);
    await reader.page.keyboard.press("Escape");
    await reader.page.goto(`${base}/policies/new`);
    await expect(
      reader.page.getByRole("heading", { name: "We can't find that page" }),
    ).toBeVisible();
  });

  test("a policy manager can manage rules", async ({ page, browser }) => {
    const { base, slug } = await startWorkspace(page, `Manager ${Date.now()}`);
    const manager = await addTeammate(browser, slug, "policy_manager");
    await createRule(manager.page, base, {
      name: "By manager",
      ...deleteIssues,
    });
    await expect(row(manager.page, "By manager")).toBeVisible();
  });

  test("a viewer sees global rules and their own agents' only", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await connectedWorkspace(page, "Viewer", "mine");
    await connect(page, base, "theirs");
    await createRule(page, base, { name: "For everyone", ...deleteIssues });
    await createRule(page, base, {
      name: "For mine",
      agent: "mine",
      operation: "github.issues.list",
      resourceKind: "repository",
    });
    await createRule(page, base, {
      name: "For theirs",
      agent: "theirs",
      operation: "linear.issues.get",
      resourceKind: "team",
    });
    const viewer = await addTeammate(browser, slug, "viewer");
    await assignAgent(slug, "mine", viewer.email);
    await viewer.page.goto(`${base}/policies`);
    await expect(row(viewer.page, "For everyone")).toBeVisible();
    await expect(row(viewer.page, "For mine")).toBeVisible();
    await expect(row(viewer.page, "For theirs")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("rules fit and work", async ({ page }) => {
    const { base } = await startWorkspace(page, `Phone ${Date.now()}`);
    await createRule(page, base, {
      name: "A rule with a rather long name for a narrow screen",
      operation: "github.repositories.administration.delete",
      resourceKind: "repository",
      resource: "acme/a-repository-with-a-long-name-for-narrow-screens",
    });
    const fits = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
    expect(await fits()).toBe(true);
    await expectAccessible(page);
    await page.getByRole("link", { name: "New rule" }).click();
    await page.waitForURL(/\/new$/);
    await page.getByRole("button", { name: "Add condition" }).click();
    expect(await fits()).toBe(true);
    await expectAccessible(page);
  });
});
