import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { connected, expectDenied, runHook, type Outcome } from "./hook";
import { expectAccessible, previewFile, publish } from "./helpers";

const rules = `- required_engine_version: 3

- list: builders
  items: [dev, infra]

- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow

- gate: Review before the pull request
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: github }
  requires:
    - { agent: qa, verdict: pass, since: { list: builders } }
    - { agent: reviewer, verdict: [ship, ship_with_debt], since: { list: builders } }
  otherwise: deny

- budget: Builder step
  step_agent: dev
  per: step
  tool_calls: 60
  otherwise: deny
`;

const session = { session_id: "e2e-session", cwd: process.cwd() };

/** One subagent's whole step, as Claude Code reports it to the hook. */
async function work(
  env: Record<string, string>,
  agent: string,
  verdict: string,
) {
  const id = `${agent}-${randomUUID().slice(0, 8)}`;
  const step = { ...session, agent_id: id, agent_type: agent };
  expectQuiet(
    await runHook({ ...step, hook_event_name: "SubagentStart" }, env),
  );
  expectQuiet(
    await runHook(
      {
        ...step,
        hook_event_name: "SubagentStop",
        last_assistant_message: `Finished.\n\n\`\`\`nodrail-receipt\nverdict: ${verdict}\n\`\`\``,
      },
      env,
    ),
  );
}

const dispatchGithub = (env: Record<string, string>) =>
  runHook(
    {
      ...session,
      hook_event_name: "PreToolUse",
      tool_name: "Agent",
      tool_input: { subagent_type: "github", prompt: "Open the pull request" },
      tool_use_id: `toolu_${randomUUID()}`,
    },
    env,
  );

const expectQuiet = (outcome: Outcome) =>
  expect(outcome).toEqual({ code: 0, stdout: "", stderr: "" });

const cells = (page: Page, table: string, row: string) =>
  page
    .getByRole("table", { name: table })
    .getByRole("row")
    .filter({ hasText: row })
    .getByRole("cell");

const section = (page: Page, question: string) =>
  page.getByRole("region", { name: question });

/**
 * The run above, counted by hand: the pull request was denied once by its
 * gate; dev worked again after qa failed, one rework loop.
 */
async function expectReport(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: "Insights" }),
  ).toBeVisible();
  const gates = section(page, "Where do gates and budgets stop work?");
  await expect(gates).toContainText("explained against the gates");
  await expect(gates.locator("[data-slot=insight-figures]")).toContainText(
    /Passed every gate without a hold\s*0 of 1 \(0%\)/,
  );
  await expect(
    cells(page, "Gates", "Review before the pull request"),
  ).toHaveText([
    "Review before the pull request",
    "2",
    "1",
    "0 of 1 (0%)",
    /qa must report pass after the latest change and after any dev or infra step ×1/,
  ]);
  await expect(cells(page, "Budgets", "Builder step")).toHaveText([
    "Builder step",
    "0",
    "None",
  ]);
  const teams = section(page, "How do agent teams work together?");
  await expect(teams.locator("[data-slot=insight-figures]")).toContainText(
    /Runs\s*1\s*Median steps per run\s*5\s*Rework loops\s*1\s*in 1 of 1 runs/,
  );
  await expect(cells(page, "Checks", "qa")).toHaveText([
    "qa",
    "1",
    "0 of 1 (0%)",
    "1 of 1 (100%)",
  ]);
  await expect(cells(page, "Agents", "dev")).toHaveText([
    "dev",
    "2",
    "done 2",
    "1",
    "0",
    "None",
  ]);
  await expect(cells(page, "Agents", "qa")).toHaveText([
    "qa",
    "2",
    "fail 1, pass 1",
    "0",
    "0",
    "None",
  ]);
  await expectAccessible(page);

  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByRole("link", { name: "7 days" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(cells(page, "Gates", "Review")).toHaveCount(5);
}

test.describe("runs in Cloud", () => {
  test("a gate holds the pull request until QA and review pass after the last change", async ({
    page,
  }) => {
    const { base, env: connection } = await connected(page, "Runs");
    const key = `feat/runs-${Date.now()}`;
    const env = { ...connection, NODRAIL_RUN: key };

    await previewFile(page, base, rules);
    await expect(
      page.getByText("Review before the pull request", { exact: true }),
    ).toBeVisible();
    await publish(page);
    await page
      .getByRole("navigation", { name: "Policies view" })
      .getByRole("link", { name: "Gates", exact: true })
      .click();
    await page.waitForURL(/\/policies\/gates$/);
    const gates = page.getByRole("main");
    await expect(gates).toContainText("Review before the pull request");
    await expect(gates).toContainText(
      "qa must report pass after the latest change and after any dev or infra step",
    );
    await page
      .getByRole("navigation", { name: "Policies view" })
      .getByRole("link", { name: "Budgets", exact: true })
      .click();
    await page.waitForURL(/\/policies\/budgets$/);
    const calls = page.getByRole("row").filter({ hasText: "Each dev step" });
    await expect(calls).toContainText("Tool calls");
    await expect(calls).toContainText("60");

    await work(env, "dev", "done");
    await work(env, "qa", "fail");

    // QA failed, so the gate denies the dispatch at once and says what is
    // missing; nothing waits for a person.
    expectDenied(await dispatchGithub(env), /gate in your rules/);

    await work(env, "dev", "done");
    await work(env, "qa", "pass");
    await work(env, "reviewer", "ship");
    // Every step is done, so the dispatch goes ahead.
    expectQuiet(await dispatchGithub(env));

    // The old address leads to Activity's runs, which say how each run stands.
    await page.goto(`${base}/runs`);
    await page.waitForURL(/activity\?view=runs$/);
    const run = page.locator("[data-slot=run-row]").filter({ hasText: key });
    await expect(run).toContainText("qa: pass");
    await expect(run).toContainText("reviewer: ship");
    await expect(run).toContainText("dev 2");
    await expectAccessible(page);

    await page.getByLabel("Outcome").selectOption("held");
    await page.waitForURL(/view=runs&outcome=held/);
    await expect(run).toHaveCount(1);
    await page.getByLabel("Outcome").selectOption("all");
    await page.waitForURL(/activity\?view=runs$/);

    await run.getByRole("link", { name: key }).click();
    await page.waitForURL(/activity\/runs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: key })).toBeVisible();
    const timeline = page.getByRole("list", { name: "Run timeline" });
    await expect(timeline.locator("[data-slot=run-entry]")).toHaveCount(12);
    await expect(timeline).toContainText("fail");
    await expect(timeline).toContainText("ship");
    await expect(timeline).toContainText(
      "Denied by gate · Review before the pull request",
    );
    await expect(timeline).toContainText("Denied: 2 of 2 requirements unmet");
    await expect(timeline).toContainText("qa reported fail (needs pass)");
    await expectAccessible(page);
    const runUrl = page.url();

    // An action's event opens in Activity's panel, not as a search.
    await timeline
      .getByRole("link", { name: "View in Activity →" })
      .first()
      .click();
    await page.waitForURL(/activity\?event=[0-9a-f-]{36}$/);
    await expect(page.getByRole("dialog")).toContainText("claude-code.agent");
    await page.goto(runUrl);

    // Its events, in Activity, narrowed to this run.
    await page.locator("[data-tour=run-activity]").click();
    await page.waitForURL(/activity\?run=[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("button", { name: `Run ${key}: show every run` }),
    ).toBeVisible();
    const events = page.locator("[data-slot=data-table] tbody tr");
    await expect(events.first()).toBeVisible();
    for (const row of await events.all())
      await expect(row).toContainText("claude-code.agent");

    // A run's old address leads to its page under Activity.
    await page.goto(runUrl.replace("/activity/runs/", "/runs/"));
    await expect(page).toHaveURL(runUrl);

    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Insights" })
      .click();
    await expectReport(page);
  });

  test("an environment with no runs says how one starts", async ({ page }) => {
    const { base } = await connected(page, "No runs");
    await page.goto(`${base}/activity?view=runs`);
    await expect(
      page.getByRole("heading", { name: "No runs yet" }),
    ).toBeVisible();
    await expectAccessible(page);

    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Insights" })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Where do gates and budgets stop work?" })
        .getByRole("heading", { name: "No runs in the last 30 days" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Import rules" }),
    ).toBeVisible();
    await expectAccessible(page);
  });
});
