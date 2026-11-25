import { expect, test, type Page } from "@playwright/test";
import { connected, runHook, shell } from "./hook";
import {
  createRule,
  expectAccessible,
  expectFitsPhone,
  waitForContent,
  withDatabase,
} from "./helpers";

const COMMAND = "pnpm audit --prod";

const glance = (page: Page) =>
  page.getByRole("region", { name: "What did the rules decide?" });

/** The agent asks for the same command this many times; no rule covers it. */
async function deniedTimes(env: Record<string, string>, times: number) {
  for (let i = 0; i < times; i += 1) await runHook(shell(COMMAND), env);
}

async function openInsights(page: Page, base: string, days?: number) {
  await page.goto(`${base}/insights${days ? `?days=${days}` : ""}`);
  await waitForContent(page);
}

/** Moves the workspace's actions this many days back, as time passing would. */
const ageActions = (slug: string, days: number) =>
  withDatabase((client) =>
    client.query(
      `UPDATE nodrail.action_requests ar
       SET created_at = ar.created_at - make_interval(days => $2),
           expires_at = ar.expires_at - make_interval(days => $2)
       FROM nodrail.workspaces w
       WHERE w.id = ar.workspace_id AND w.slug = $1`,
      [slug, days],
    ),
  );

test.describe("Insights", () => {
  test("says what the rules decided, and where a rule is missing", async ({
    page,
  }) => {
    const { base, env } = await connected(page, "Decisions");
    await deniedTimes(env, 3);

    await openInsights(page, base);
    await expect(glance(page)).toContainText(/No rule covers them\s*3/);
    await expect(glance(page)).not.toContainText(/approv/i);
    await expect(page.getByRole("region", { name: /approv/i })).toHaveCount(0);
    await expectAccessible(page);

    await createRule(page, base, {
      name: "Allow audits",
      decision: "Allow",
      operation: "shell.command.run",
      resourceKind: "command",
      resource: COMMAND,
      match: "prefix",
    });
    // The same command now goes ahead, decided by the rule.
    expect(await runHook(shell(COMMAND), env)).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    await openInsights(page, base);
    await expect(glance(page)).toContainText(/Allowed\s*1/);
    // The new rule did the work: it is the one that matched most.
    await expect(
      page.getByRole("region", { name: "Are the rules doing the work?" }),
    ).toContainText(/Allow audits\s*Allow\s*1 action/);
  });

  test("the window changes the numbers", async ({ page }) => {
    const { base, env, slug } = await connected(page, "Window");
    await deniedTimes(env, 3);
    await ageActions(slug, 10);

    await openInsights(page, base, 7);
    await expect(glance(page)).toContainText("No actions in the last 7 days");

    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/days=30/);
    await expect(glance(page)).toContainText(/Denied\s*3/);
  });

  test("fits a phone", async ({ page }) => {
    const { base, env } = await connected(page, "Phone");
    await deniedTimes(env, 3);
    await page.setViewportSize({ width: 390, height: 844 });
    await openInsights(page, base);
    await expect(glance(page)).toContainText(/No rule covers them\s*3/);
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});
