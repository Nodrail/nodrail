import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { connected, expectDenied, runHook, server, shell } from "./hook";
import {
  addTeammate,
  confirmPublish,
  expectAccessible,
  expectFitsPhone,
  previewFile,
  publish,
  startWorkspace,
} from "./helpers";

const allowStatus = `
- rule: Allow status
  tool: shell
  operation: command.run
  resource: { kind: command, match: exact, value: git status }
  effect: allow
`;

test.describe("rules from YAML", () => {
  test("a file is previewed, published and enforced", async ({ page }) => {
    const { base, env } = await connected(page, "File");
    await previewFile(page, base, allowStatus);
    await expect(page.getByText("Allow status", { exact: true })).toBeVisible();
    await expect(page.getByText("1 change, 0 unchanged.")).toBeVisible();
    await expectAccessible(page);
    await publish(page);
    await expect(
      page.getByRole("link", { name: "Allow status", exact: true }),
    ).toBeVisible();
    const outcome = await runHook(shell("git status"), env);
    expect(outcome).toEqual({ code: 0, stdout: "", stderr: "" });
    await page.goto(`${base}/overview`);
    await expect(
      page.getByRole("link").filter({ hasText: "git status" }),
    ).toBeVisible();
  });

  test("console publication keeps warning about the repository after the live policy changes", async ({
    page,
  }) => {
    const { base, slug } = await startWorkspace(page, `Pinned ${Date.now()}`);
    await previewFile(
      page,
      base,
      allowStatus.replace("Allow status", "Stale draft"),
    );
    const projectId = randomUUID();
    const csrf = await page.request.get("/api/v1/session/csrf", {
      headers: { "X-Nodrail-CSRF": "fetch" },
    });
    expect(csrf.ok()).toBe(true);
    const { token } = (await csrf.json()) as { token: string };
    const headers = { origin: server, "X-Nodrail-CSRF": token };
    const query = new URLSearchParams({
      workspace: slug,
      environment: "development",
    });
    const review = await page.request.post(`/api/v1/rules/preview?${query}`, {
      headers,
      data: { yaml: allowStatus },
    });
    expect(review.ok()).toBe(true);
    const { policy_revision, file_digest } = (await review.json()) as {
      policy_revision: number;
      file_digest: string;
    };
    const applied = await page.request.post(`/api/v1/rules/publish?${query}`, {
      headers,
      data: {
        yaml: allowStatus,
        policy_revision,
        file_digest,
        managed: {
          project_id: projectId,
          revision: "a".repeat(64),
          policy_revision: null,
        },
      },
    });
    expect(applied.ok()).toBe(true);

    await confirmPublish(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Repository ownership changed",
    );

    await previewFile(page, base, "[]");
    await expect(
      page.getByText("Repository policy for " + projectId + "."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Publish rules" }).click();
    await expect(page.getByRole("dialog")).toContainText("out of sync");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Publish rules" })
      .click();
    await expect(page).toHaveURL(`${base}/policies`);
    const live = await page.request.get(`/api/v1/rules/live?${query}`);
    expect(live.ok()).toBe(true);
    expect(await live.json()).toMatchObject({ managed: null });
    await expect(
      page.getByText("Repository policy for " + projectId + "."),
    ).toBeVisible();

    await previewFile(page, base, allowStatus);
    await page.getByRole("button", { name: "Publish rules" }).click();
    await expect(page.getByRole("dialog")).toContainText("out of sync");
  });

  test("problems are shown by line and block publishing", async ({ page }) => {
    const { base } = await startWorkspace(page, `Bad ${Date.now()}`);
    await previewFile(page, base, "- rule: Bad\n  effect: maybe\n");
    await expect(page.getByText("Fix these first")).toBeVisible();
    await expect(page.getByText("Line 1", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Publish rules" }),
    ).toHaveCount(0);
  });

  test("what would be removed is shown first", async ({ page }) => {
    const { base } = await startWorkspace(page, `Remove ${Date.now()}`);
    await previewFile(page, base, allowStatus);
    await publish(page);
    await previewFile(page, base, "[]\n");
    await expect(
      page.getByRole("heading", { name: "Removed (1)" }),
    ).toBeVisible();
  });

  test("an export comes back with nothing to change", async ({ page }) => {
    const { base } = await startWorkspace(page, `Trip ${Date.now()}`);
    await previewFile(page, base, allowStatus);
    await publish(page);
    // On the Rules tab, export waits under More beside New rule.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "More policy actions" }).click();
    await page.getByRole("menuitem", { name: "Export YAML" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.yaml$/);
    const response = await page.request.get(`${base}/policies/export`);
    await previewFile(page, base, await response.text());
    await expect(page.getByText("There is nothing to publish")).toBeVisible();
  });

  test("an environment's policies are copied to another after a review", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Copy ${Date.now()}`);
    await previewFile(page, base, allowStatus);
    await publish(page);

    // The YAML tab acts on the file only: copy, export, import; no New rule.
    await page.goto(`${base}/policies/yaml`);
    const actions = page.locator("[data-tour=policies-actions]");
    await expect(actions.getByRole("link")).toHaveText([
      "Copy to Production…",
      "Export YAML",
      "Import YAML",
    ]);

    // From a list tab it waits under More.
    await page.goto(`${base}/policies`);
    await page.getByRole("button", { name: "More policy actions" }).click();
    await page.getByRole("menuitem", { name: "Copy to Production…" }).click();
    await page.waitForURL(/\/production\/policies\/import\?from=development$/);
    await expect(
      page.getByRole("heading", { name: "Copy policies to Production" }),
    ).toBeVisible();
    await expect(page.getByLabel("Or paste YAML")).toHaveValue(/Allow status/);
    // Already previewed against Production, ready to review.
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(page.getByText("Allow status", { exact: true })).toBeVisible();
    await expectAccessible(page);
    await publish(page);
    await expect(page).toHaveURL(/\/production\/policies$/);
    await expect(
      page.getByRole("link", { name: "Allow status", exact: true }),
    ).toBeVisible();
  });

  test("a stale preview is refused", async ({ page, browser }) => {
    const { base, slug } = await startWorkspace(page, `Stale ${Date.now()}`);
    const other = await addTeammate(browser, slug, "admin");
    await previewFile(page, base, allowStatus);
    await previewFile(
      other.page,
      base,
      allowStatus.replace("Allow status", "Theirs"),
    );
    await publish(other.page);
    await confirmPublish(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "changed since this preview",
    );
    await other.page.context().close();
  });

  test("editing after the preview cannot publish unseen rules", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Edit ${Date.now()}`);
    await previewFile(page, base, allowStatus);
    await page
      .getByLabel("Or paste YAML")
      .fill(allowStatus.replace("Allow status", "Something else"));
    const publish = page.getByRole("button", { name: "Publish rules" });
    await expect(publish).toHaveCount(0);

    await page.getByLabel("Or paste YAML").fill(allowStatus);
    await expect(publish).toHaveCount(0);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(publish).toBeVisible();
  });

  test("a starter pack from an empty page governs reads and chains", async ({
    page,
  }) => {
    const { base, env } = await connected(page, "Pack");
    await page.goto(`${base}/policies`);
    await page.getByRole("link", { name: "Start with read only" }).click();
    await expect(page.getByLabel("Or paste YAML")).toHaveValue(/Read files/);
    await page.getByRole("button", { name: "Preview" }).click();
    await publish(page);
    const read = (file_path: string) => ({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path },
      tool_use_id: `toolu_${randomUUID()}`,
    });
    const quiet = { code: 0, stdout: "", stderr: "" };
    expect(await runHook(read("/repo/src/a.ts"), env)).toEqual(quiet);
    // The hook stops a secret read on the machine, before Nodrail is asked.
    expectDenied(await runHook(read("/repo/.env"), env), /credentials/);
    expect(await runHook(shell("cd src && git status"), env)).toEqual(quiet);
    // No rule covers it: denied at once, saying so.
    expectDenied(
      await runHook(shell("cd src && mystery"), env),
      /no rule covers/i,
    );
  });

  test("people who cannot write rules get neither", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await startWorkspace(page, `Who ${Date.now()}`);
    const viewer = await addTeammate(browser, slug, "viewer");
    await viewer.page.goto(`${base}/policies`);
    // They can read rules as YAML (policies-yaml.spec.ts), not import or export.
    await expect(
      viewer.page.getByRole("button", { name: "More policy actions" }),
    ).toHaveCount(0);
    await viewer.page.goto(`${base}/policies/yaml`);
    await expect(
      viewer.page.getByRole("link", { name: /(Import|Export) YAML|Copy to/ }),
    ).toHaveCount(0);
    expect((await viewer.page.goto(`${base}/policies/import`))?.status()).toBe(
      404,
    );
    expect(
      (
        await viewer.page.goto(
          `${base.replace(/development$/, "production")}/policies/import?from=development`,
        )
      )?.status(),
    ).toBe(404);
    expect(
      (await viewer.page.request.get(`${base}/policies/export`)).status(),
    ).toBe(403);
    await viewer.page.context().close();
  });

  test("fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { base } = await startWorkspace(page, `Phone ${Date.now()}`);
    await previewFile(page, base, allowStatus);
    await expectFitsPhone(page);
    await expectAccessible(page);
  });
});
