import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { server, shell } from "./hook";
import { startWorkspace, workspacePage } from "./helpers";

const exec = promisify(execFile);
const cli = resolve("../../packages/cli/dist/nodrail.mjs");

test("the generated check finds a redacted decision from the installed project hook", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { base } = await startWorkspace(page, `Check-in ${Date.now()}`);
  await page.goto(workspacePage(base, "account/tokens"));
  await page.getByRole("button", { name: "Create token" }).click();
  const tokenDialog = page.getByRole("dialog", { name: "Create an API token" });
  await tokenDialog.getByLabel("Name").fill("Project test");
  await tokenDialog.getByRole("checkbox", { name: /publish/i }).check();
  await tokenDialog.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByLabel("API token", { exact: true }).innerText();

  const home = mkdtempSync(join(tmpdir(), "nodrail-project-check-"));
  try {
    const bin = join(home, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "claude"),
      "#!/bin/sh\necho '2.1.328 (Claude Code)'\n",
      { mode: 0o700 },
    );
    const env = { HOME: home, PATH: `${bin}:${process.env.PATH}` };
    const desk = join(home, "desk");
    await exec("node", [cli, "example", "support-desk", "./desk"], {
      cwd: home,
      env,
    });
    const signin = exec(
      "node",
      [cli, "login", "--url", server, "--token-stdin"],
      { cwd: desk, env },
    );
    signin.child.stdin?.end(`${token}\n`);
    await signin;

    await page.goto(`${base}/agents/connect`);
    const connect = await page.getByLabel("Connect command").innerText();
    await expect(
      page.getByLabel("Create and connect the example project"),
    ).toHaveText(`nodrail example support-desk ./desk && cd desk\n${connect}`);
    const command = await page.getByLabel("Check-in command").innerText();
    expect(command).toMatch(/^echo nodrail-check-[a-f0-9]{16}$/);
    await exec("node", [cli, ...connect.split(" ").slice(1)], {
      cwd: desk,
      env,
    });
    await exec("node", [cli, "apply", "--runtime", "claude-code", "--yes"], {
      cwd: desk,
      env,
    });

    const settings = JSON.parse(
      readFileSync(join(desk, ".claude/settings.json"), "utf8"),
    );
    const installed = settings.hooks.PreToolUse[0].hooks[0].command as string;
    const hook = async (text: string, metadata = {}) => {
      const call = exec("/bin/sh", ["-c", installed], {
        cwd: desk,
        env: { ...env, CLAUDE_PROJECT_DIR: desk },
      });
      call.child.stdin?.end(
        JSON.stringify({
          ...shell(text),
          cwd: desk,
          session_id: "check-in",
          ...metadata,
        }),
      );
      return (await call).stdout;
    };

    await page.getByRole("link", { name: "Activity for this check" }).click();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get("check_token") === command.slice(5),
    );
    const waiting = page.getByText("Waiting for the first check to arrive.");
    await expect(waiting).toBeVisible();
    await hook("echo unrelated-check");
    expect(await hook(command)).toContain('"permissionDecision":"deny"');
    const filtered = page.url();
    const decisions = page.locator("[data-slot=data-table] tbody tr");
    await expect(decisions).toHaveCount(1, { timeout: 15_000 });
    await expect(waiting).toBeHidden();
    await expect(decisions.first()).toContainText("redacted");
    await expect(decisions.first()).toContainText("marketing");
    await expect(decisions.first()).not.toContainText(command);

    await page.goto(`${base}/agents/support/settings`);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const pause = page.getByRole("dialog");
    await expect(pause).toContainText("the main session runs as marketing");
    await pause.getByRole("button", { name: "Pause agent" }).click();
    await expect(pause).toBeHidden();
    expect(await hook("git status")).toBe("");
    expect(await hook("git status", { agent_id: "unnamed" })).toContain(
      "Access is paused for support",
    );
    expect(
      await hook("git status", { agent_id: "known", agent_type: "support" }),
    ).toContain("Access is paused for support");
    await page.goto(`${base}/activity`);
    await expect(async () => {
      await page.reload();
      await expect(
        decisions.filter({ hasText: "Denied: support paused" }),
      ).toHaveCount(2, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    const denial = decisions
      .filter({ hasText: "Denied: support paused" })
      .first();
    await expect(denial).toContainText("redacted");
    await denial.getByRole("button", { name: /actions/i }).click();
    await page
      .getByRole("menuitem", { name: "Open run session:check-in" })
      .click();
    await expect(
      page
        .getByRole("list", { name: "Run timeline" })
        .getByText("Denied: support paused"),
    ).toHaveCount(2);
    await page.goto(filtered);
    await expect(decisions.filter({ hasText: "redacted" })).toHaveCount(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
