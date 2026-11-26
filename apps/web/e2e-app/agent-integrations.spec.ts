import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import {
  clientVersion,
  connected,
  expectDenied,
  runHook,
  server,
  type Outcome,
} from "./hook";
import {
  connect,
  createRule,
  openStandaloneSetup,
  startWorkspace,
} from "./helpers";

const execFileAsync = promisify(execFile);

/**
 * Runs a program with nothing on its input. `codex exec` reads a piped stdin
 * until it closes, so an open one leaves it waiting instead of working.
 */
function run(...args: Parameters<typeof execFileAsync>) {
  const running = execFileAsync(...args);
  running.child.stdin?.end();
  return running;
}
const packages = resolve(process.cwd(), "../../packages");
const plugins = join(packages, "agent-plugins");

const activityRow = (page: import("@playwright/test").Page, text: string) =>
  page.locator("[data-slot=data-table] tbody tr").filter({ hasText: text });

/** Opens the newest call no rule covered, from Activity. */
async function openNewestDenial(
  page: import("@playwright/test").Page,
  base: string,
) {
  await page.goto(`${base}/activity`);
  await activityRow(page, "Denied · no rule covers it")
    .first()
    .getByRole("link")
    .first()
    .click();
}

const cleared = (outcome: Outcome) =>
  expect(outcome).toEqual({ code: 0, stdout: "", stderr: "" });

const allowCommand = (
  page: import("@playwright/test").Page,
  base: string,
  resource: string,
) =>
  createRule(page, base, {
    name: `Allow ${resource}`,
    decision: "Allow",
    operation: "shell.command.run",
    resourceKind: "command",
    resource,
    match: "prefix",
  });

test.describe("the TypeScript SDK inside real agent frameworks", () => {
  test.setTimeout(120_000);

  test("every framework runs what is allowed and blocks the rest", async ({
    page,
  }) => {
    const { base, env } = await connected(page, "Frameworks");
    await createRule(page, base, {
      name: "Allow issues",
      decision: "Allow",
      operation: "create_issue.call",
      resourceKind: "tool",
    });

    const { stdout } = await run(
      "node",
      ["--import", "tsx", "tests/live/frameworks.ts"],
      {
        cwd: join(packages, "client"),
        env: { PATH: process.env.PATH, ...env },
        timeout: 90_000,
      },
    );
    const results = JSON.parse(stdout.trim().split("\n").pop() ?? "[]") as {
      label: string;
      allowed: string;
      allowedRan: number;
      blocked: string;
      blockedRan: number;
    }[];

    expect(results.map((result) => result.label)).toEqual([
      "langchain",
      "langchain-middleware",
      "ai-sdk",
      "openai-agents",
    ]);
    for (const result of results) {
      expect(result.allowedRan, result.label).toBe(1);
      expect(result.allowed, result.label).toContain("ran");
      expect(result.blockedRan, result.label).toBe(0);
      expect(result.blocked, result.label).toMatch(/denied.*REQ-/);
    }

    await page.goto(`${base}/activity`);
    await expect(activityRow(page, "Allowed by rule")).toHaveCount(4);
    await expect(activityRow(page, "Allowed by rule").first()).toContainText(
      "Client reported success",
    );
    await openNewestDenial(page, base);
    await expect(page.getByText("delete_repo.call").first()).toBeVisible();
  });
});

test.describe("the connect page", () => {
  test("generates project commands for all three hosts and the current environment", async ({
    page,
  }) => {
    const { base, slug } = await startWorkspace(page, `Project ${Date.now()}`);
    await page.goto(`${base}/agents/connect`);
    await expect(page.getByLabel("Install the CLI")).toHaveText(
      "npm i -g @nodrail/cli",
    );
    await expect(page.getByText("pnpm add -g @nodrail/cli")).toBeVisible();
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    const copied = `nodrail connect ${server} --workspace ${slug} --environment development --runtime claude-code`;
    await expect(page.getByLabel("Connect command")).toHaveText(copied);
    await page.getByRole("button", { name: "Copy connect command" }).click();
    await expect(page.getByText("Copied.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      copied,
    );
    await expect(page.getByLabel("Agent ID")).toBeHidden();
    const fresh = `nodrail example support-desk ./desk && cd desk\n${copied}`;
    await expect(
      page.getByLabel("Create and connect the example project"),
    ).toHaveText(fresh);
    await page.getByRole("button", { name: "Copy example setup" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      fresh,
    );
    await page.getByText("Edit nodrail.yaml by hand", { exact: true }).click();
    await expect(page.getByText(/runtime list to|in runtimes/)).toHaveCount(0);
    for (const [choice, runtime] of [
      ["Claude Code", "claude-code"],
      ["Codex", "codex"],
      ["GitHub Copilot CLI", "copilot"],
    ]) {
      await page.getByRole("radio", { name: choice, exact: true }).check();
      await expect(page.getByLabel("Connect command")).toHaveText(
        `nodrail connect ${server} --workspace ${slug} --environment development --runtime ${runtime}`,
      );
      const commands = page.getByLabel("Apply command");
      await expect(commands).toContainText(
        `nodrail apply --runtime ${runtime}`,
      );
    }
    await expect(page.getByText(/choose to remember it/)).toBeVisible();
    await page.goto(
      `${base.replace(/development$/, "production")}/agents/connect`,
    );
    await expect(page.getByLabel("Connect command")).toHaveText(
      `nodrail connect ${server} --workspace ${slug} --environment production --runtime claude-code`,
    );
  });

  test("Codex uses project enrollment instead of a standalone credential", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `Codex project ${Date.now()}`);
    await page.goto(`${base}/agents/connect`);
    await openStandaloneSetup(page);
    await expect(page.getByText(/For Codex, choose Codex above/)).toBeVisible();
    await expect(
      page.getByRole("radio", { name: "Codex", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("radio", { name: "Codex", exact: true }).check();
    await expect(page.getByLabel("Apply command")).toContainText(
      "nodrail apply --runtime codex",
    );
    await expect(page.getByLabel("Connect command")).toContainText(
      `nodrail connect ${server}`,
    );
    await expect(
      page.getByText("~/.nodrail/credential", { exact: false }),
    ).toHaveCount(0);
  });

  test("still offers the SDK with its installation command", async ({
    page,
  }) => {
    const { base } = await startWorkspace(page, `SDK ${Date.now()}`);
    await page.goto(`${base}/agents/connect`);
    await openStandaloneSetup(page);
    await page.getByLabel("Agent ID").fill("coder");
    await page.getByRole("radio", { name: /TypeScript SDK/ }).check();
    await page.getByRole("button", { name: "Create credential" }).click();
    await expect(page.getByLabel("Install the SDK")).toContainText(
      "npm install @nodrail/client",
    );
    await expect(page.getByLabel("Framework example")).toContainText(
      "guard(tools)",
    );
  });
});

test.describe("the Codex hook against the real service", () => {
  const event = (tool_name: string, tool_input: object) => ({
    hook_event_name: "PreToolUse",
    tool_name,
    tool_input,
    tool_use_id: `call_${randomUUID()}`,
    cwd: "/tmp/project",
    session_id: "s",
    turn_id: "t",
  });

  test("commands, patches and MCP tools are all governed", async ({ page }) => {
    const { base, env } = await connected(page, "Codex");
    await allowCommand(page, base, "git status");

    cleared(
      await runHook(event("Bash", { command: "git status" }), env, ["codex"]),
    );
    const bash = await runHook(event("Bash", { command: "npm publish" }), env, [
      "codex",
    ]);
    expectDenied(bash, /denied/);

    const patch = `*** Begin Patch\n*** Update File: src/a.ts\n@@\n-SECRETBODY\n+SECRETNEW\n*** End Patch`;
    expectDenied(
      await runHook(event("apply_patch", { command: patch }), env, ["codex"]),
      /denied/,
    );
    expectDenied(
      await runHook(event("mcp__github__create_issue", { title: "x" }), env, [
        "codex",
      ]),
      /denied/,
    );

    await page.goto(`${base}/activity`);
    const listed = await page.content();
    expect(listed).not.toContain("SECRETBODY");
    await expect(page.locator("body")).toContainText("files.file.edit");

    await page.goto(`${base}/agents/coder/settings`);
    await expect(page.getByText(`codex-hook/${clientVersion}`)).toBeVisible();
  });

  test("a hook that can't reach Nodrail blocks instead of letting Codex run it", async ({
    page,
  }) => {
    const { env } = await connected(page, "Codex offline");
    expectDenied(
      await runHook(
        event("Bash", { command: "git status" }),
        {
          ...env,
          NODRAIL_URL: "http://127.0.0.1:9",
        },
        ["codex"],
      ),
      /UNAVAILABLE/,
    );
  });
});

/**
 * The real CLIs, installing the real plugins. Spends model tokens, so it runs
 * only when asked: NODRAIL_E2E_REAL_AGENTS=1.
 */
test.describe("real agents through the installed plugins", () => {
  test.skip(!process.env.NODRAIL_E2E_REAL_AGENTS, "needs a logged-in CLI");
  test.setTimeout(420_000);

  const prompt =
    "Use your shell tool for each of these, one at a time, exactly as written, and do nothing else. 1) git status --short 2) npm publish --dry-run. Then say which ran and which were blocked.";

  async function expectGoverned(
    page: import("@playwright/test").Page,
    base: string,
    agent: string,
  ) {
    await page.goto(`${base}/activity`);
    await expect(activityRow(page, "git status --short")).toContainText(
      "Allowed by rule",
    );
    await openNewestDenial(page, base);
    await expect(page.locator("[data-slot=inert-json]")).toContainText(
      "npm publish --dry-run",
    );
    await page.goto(`${base}/agents/coder/settings`);
    await expect(
      page.getByText(`${agent}-hook/${clientVersion}`),
    ).toBeVisible();
  }

  test("Claude Code", async ({ page }) => {
    const { base, credential } = await connected(page, "Real Claude");
    await allowCommand(page, base, "git status");
    const cwd = mkdtempSync(join(tmpdir(), "nodrail-claude-"));
    await run("git", ["init", "-q"], { cwd });
    const claude = (args: string[], timeout = 60_000) =>
      run("claude", args, {
        cwd,
        timeout,
        env: process.env,
      });
    try {
      await claude([
        "plugin",
        "marketplace",
        "add",
        plugins,
        "--scope",
        "local",
      ]);
      await claude([
        "plugin",
        "install",
        "nodrail@nodrail",
        "--scope",
        "local",
        "--config",
        `credential=${credential}`,
        "--config",
        `url=${server}`,
      ]);
      const { stdout } = await claude(
        [
          "-p",
          prompt,
          // The plugin's settings live in user settings whatever the install
          // scope, so leaving them out would drop the configured URL.
          "--setting-sources",
          "user,local",
          "--allowedTools",
          "Bash",
          "--model",
          "haiku",
          "--max-turns",
          "6",
        ],
        180_000,
      );
      console.log(`claude: ${stdout.replace(/\s+/g, " ").slice(0, 500)}`);
      await expectGoverned(page, base, "claude-code");
    } finally {
      await claude([
        "plugin",
        "uninstall",
        "nodrail@nodrail",
        "--scope",
        "local",
      ]).catch(() => undefined);
      await claude([
        "plugin",
        "marketplace",
        "remove",
        "nodrail",
        "--scope",
        "local",
      ]).catch(() => undefined);
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("Codex", async ({ page }) => {
    const { base } = await startWorkspace(page, `Real Codex ${Date.now()}`);
    const credential = await connect(page, base, "coder");
    await allowCommand(page, base, "git status");
    const cwd = mkdtempSync(join(tmpdir(), "nodrail-codex-"));
    const codexHome = mkdtempSync(join(tmpdir(), "nodrail-codex-home-"));
    const nodrailHome = join(codexHome, "nodrail");
    mkdirSync(nodrailHome);
    writeFileSync(join(nodrailHome, "credential"), credential, { mode: 0o600 });
    symlinkSync(
      join(homedir(), ".codex", "auth.json"),
      join(codexHome, "auth.json"),
    );
    await run("git", ["init", "-q"], { cwd });
    const env = {
      ...process.env,
      CODEX_HOME: codexHome,
      NODRAIL_URL: server,
      NODRAIL_HOME: nodrailHome,
      NODRAIL_WAIT_SECONDS: "0",
    };
    const codexCli = (args: string[], timeout = 60_000) =>
      run("codex", args, { cwd, timeout, env });
    try {
      await codexCli(["plugin", "marketplace", "add", plugins]);
      await codexCli(["plugin", "add", "nodrail@nodrail"]);
      expect(readFileSync(join(codexHome, "config.toml"), "utf8")).toContain(
        "nodrail",
      );
      const { stdout } = await codexCli(
        [
          "exec",
          "--dangerously-bypass-hook-trust",
          "--skip-git-repo-check",
          "-s",
          "workspace-write",
          prompt,
        ],
        240_000,
      );
      console.log(`codex: ${stdout.replace(/\s+/g, " ").slice(-500)}`);
      await expectGoverned(page, base, "codex");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});
