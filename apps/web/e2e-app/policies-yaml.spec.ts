import { expect, test, type Page } from "@playwright/test";
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

const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Rules as YAML" });

/** A workspace with one published rule, open on its YAML view. */
async function openYaml(page: Page, label: string) {
  const workspace = await startWorkspace(page, `${label} ${Date.now()}`);
  await previewFile(page, workspace.base, allowStatus);
  await publish(page);
  await page
    .getByRole("navigation", { name: "Policies view" })
    .getByRole("link", { name: "YAML" })
    .click();
  await page.waitForURL(/\/policies\/yaml$/);
  await expect(editor(page)).toContainText("Allow status");
  return workspace;
}

/** Types at the end of the file, as a person would. */
async function append(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.insertText(text);
}

const problems = (page: Page) => page.getByRole("region", { name: "Problems" });

test.describe("rules as YAML", () => {
  test("edited, checked as you type, reviewed and published", async ({
    page,
  }) => {
    const { base } = await openYaml(page, "Yaml");
    await expect(problems(page)).toContainText("No problems");
    await expectAccessible(page);

    await append(
      page,
      "- rule: Allow log\n  command: git log\n  effect: maybe\n",
    );
    const problem = problems(page).getByRole("button", {
      name: /Rule "Allow log" effect/,
    });
    await expect(problem).toBeVisible();
    // At the bad value itself: "  effect: maybe" has it at column 11.
    await expect(problem).toContainText(/Line \d+:11(?!\d)/);
    await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Review changes" }),
    ).toBeDisabled();

    // Choosing the problem puts the cursor on its line.
    await problem.click();
    await expect(page.locator(".cm-activeLine")).toContainText("effect: maybe");

    // Leaving with unpublished edits asks first; staying keeps them.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page
      .getByRole("navigation", { name: "Policies view" })
      .getByRole("link", { name: "Rules" })
      .click();
    await expect(page).toHaveURL(/\/policies\/yaml$/);

    await editor(page).click();
    await page.keyboard.press("ControlOrMeta+End");
    // "maybe" and the line break after it.
    for (let left = 6; left > 0; left -= 1)
      await page.keyboard.press("Backspace");
    await page.keyboard.insertText("allow\n");
    await expect(problems(page)).toContainText("No problems");

    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Added (1)" }),
    ).toBeVisible();
    await expect(page.getByText("1 change, 1 unchanged.")).toBeVisible();
    await expectAccessible(page);

    await publish(page);
    await expect(
      page.getByRole("link", { name: "Allow log", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Allow status", exact: true }),
    ).toBeVisible();
    await page.goto(`${base}/policies/yaml`);
    await expect(editor(page)).toContainText("Allow log");
  });

  test("groups rules, gates and budgets that fold, colored by what they do", async ({
    page,
  }) => {
    const workspace = await startWorkspace(page, `Groups ${Date.now()}`);
    await previewFile(
      page,
      workspace.base,
      `- required_engine_version: 3
${allowStatus}
- rule: Never force push
  tool: shell
  operation: command.run
  resource: { kind: command, match: prefix, value: git push --force }
  effect: deny
- rule: Push branches
  tool: shell
  operation: command.run
  resource: { kind: command, match: prefix, value: git push origin }
  effect: allow
- gate: QA first
  tool: github
  operation: pr.create
  resource: { kind: repository, match: any }
  requires: [{ agent: qa, verdict: pass, since: [dev] }]
- budget: Calls per run
  per: run
  tool_calls: 60
  otherwise: deny
`,
    );
    await publish(page);
    // Tall enough for the whole file: the editor draws only what is on screen.
    await page.setViewportSize({ width: 1280, height: 1800 });
    await page.goto(`${workspace.base}/policies/yaml`);
    const area = page.locator("[data-slot=yaml-editor]");
    // The group buttons sit above the editor, outside its text.
    const groups = page.getByRole("group", { name: "Fold groups" });
    const heading = (name: string) =>
      groups.getByRole("button", { name: new RegExp(`^${name} · \\d`) });
    const inEditor = (kind: string) =>
      area.locator(`.cm-policy-group[data-group=${kind}]`);
    for (const name of ["Rules", "Gates", "Budgets"])
      await expect(heading(name)).toHaveAttribute("aria-expanded", "true");
    await expect(heading("Rules")).toHaveAttribute(
      "aria-controls",
      "rules-yaml-editor",
    );
    await expect(area.getByRole("button")).toHaveCount(0);
    await expect(area.locator(".cm-policy-badge")).toHaveText([
      "Allow",
      "Deny",
      "Allow",
      "Gate",
      "Budget",
    ]);
    // The legend names the same four in the same words.
    await expect(
      page.getByRole("list", { name: "Colors in the editor" }),
    ).toHaveText(/Allow\s*Deny\s*Gate\s*Budget/);
    await expect(
      area.locator(".cm-policy-bar.cm-policy-gate").first(),
    ).toBeVisible();
    await area.screenshot({ path: "test-results/yaml-groups.png" });

    // A group folds from its button, by keyboard, and opens again; the
    // heading in the editor folds the same group.
    await heading("Rules").focus();
    await page.keyboard.press("Enter");
    await expect(area.locator(".cm-foldPlaceholder")).toHaveCount(0);
    await expect(editor(page)).not.toContainText("git push --force");
    await expect(heading("Rules")).toHaveAttribute("aria-expanded", "false");
    await expect(inEditor("rule")).toContainText("3 rules folded");
    await inEditor("rule").click();
    await expect(heading("Rules")).toHaveAttribute("aria-expanded", "true");
    await expect(editor(page)).toContainText("git push --force");

    // An entry folds from the arrow by its line number, a 24px target.
    const gateLine = area
      .locator(".cm-line")
      .filter({ hasText: "gate: QA first" });
    await expect(gateLine).toBeVisible();
    const top = (await gateLine.boundingBox())?.y ?? -1;
    const arrow = area
      .locator(".cm-foldGutter .cm-gutterElement")
      .filter({ has: page.locator("span") });
    let target = null;
    for (const element of await arrow.all())
      if (Math.abs(((await element.boundingBox())?.y ?? -99) - top) < 4)
        target = element;
    expect(target, "an arrow beside the gate's first line").not.toBeNull();
    const size = await target!.locator("span").boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(24);
    expect(size?.height).toBeGreaterThanOrEqual(24);
    await target!.locator("span").click();
    await expect(editor(page)).not.toContainText("since:");
    await expect(editor(page)).toContainText("gate: QA first");

    // And by keyboard, as the hint says, from the entry's first line.
    await target!.locator("span").click();
    await expect(editor(page)).toContainText("since:");
    await gateLine.click();
    const mac = process.platform === "darwin";
    await page.keyboard.press(
      mac ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft",
    );
    await expect(editor(page)).not.toContainText("since:");
    await expect(page.getByText(/Ctrl\+Shift\+\[/)).toBeVisible();
    await area.screenshot({ path: "test-results/yaml-groups-folded.png" });
    await expectAccessible(page);
  });

  test("what the server finds is shown on its line", async ({ page }) => {
    await openYaml(page, "Agent");
    await append(
      page,
      "- rule: For a stranger\n  agent: nobody\n  command: git log\n  effect: allow\n",
    );
    await expect(problems(page)).toContainText("No problems");
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(
      problems(page).getByRole("button", { name: /No agent called "nobody"/ }),
    ).toContainText("review");
    await expect(
      page.getByRole("button", { name: "Publish rules" }),
    ).toHaveCount(0);
  });

  test("a publish after someone else's is refused", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await openYaml(page, "Race");
    await append(page, "- rule: Mine\n  command: git log\n  effect: allow\n");
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();

    // Someone else publishes their own edit first.
    const other = await addTeammate(browser, slug, "admin");
    await other.page.goto(`${base}/policies/yaml`);
    await append(
      other.page,
      "- rule: Theirs\n  command: git diff\n  effect: allow\n",
    );
    await other.page.getByRole("button", { name: "Review changes" }).click();
    await publish(other.page);

    await confirmPublish(page);
    const refusal = page.getByRole("dialog").getByRole("alert");
    await expect(refusal).toContainText("changed since this preview");
    await expect(refusal).toContainText("Reload");
    await other.page.context().close();
  });

  test("a viewer reads the same file but cannot change it", async ({
    page,
    browser,
  }) => {
    const { base, slug } = await openYaml(page, "Viewer");
    const viewer = await addTeammate(browser, slug, "viewer");
    await viewer.page.goto(`${base}/policies`);
    await viewer.page
      .getByRole("navigation", { name: "Policies view" })
      .getByRole("link", { name: "YAML" })
      .click();
    const readOnly = viewer.page.getByRole("textbox", {
      name: "Rules as YAML, read only",
    });
    await expect(readOnly).toContainText("Allow status");
    await expect(readOnly).toHaveAttribute("aria-readonly", "true");
    await expect(viewer.page.getByText("No problems")).toBeVisible();
    await expect(
      viewer.page.getByRole("button", { name: "Review changes" }),
    ).toHaveCount(0);
    await expectAccessible(viewer.page);
    await readOnly.click();
    await viewer.page.keyboard.insertText("typed");
    await expect(readOnly).not.toContainText("typed");
    await viewer.page.context().close();
  });

  test("fits a phone", async ({ page }) => {
    await openYaml(page, "Phone");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(editor(page)).toBeVisible();
    await expectFitsPhone(page);
  });
});
