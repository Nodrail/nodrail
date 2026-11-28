import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { connect, startWorkspace } from "./helpers";

const hookFile = resolve(
  process.cwd(),
  "../../packages/sdk/dist/nodrail-hook.mjs",
);
export const server = "http://127.0.0.1:3201";

/** The version the hook and SDK report, so tests follow every release. */
export const clientVersion = (
  JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/sdk/package.json"),
      "utf8",
    ),
  ) as { version: string }
).version;

export type Outcome = { code: number | null; stdout: string; stderr: string };

/** The built hook, as Claude Code starts it: a process, JSON on stdin. */
export function runHook(
  event: object,
  env: Record<string, string>,
  args: string[] = [],
) {
  return new Promise<Outcome>((done, fail) => {
    const child = spawn("node", [hookFile, ...args], {
      env: { PATH: process.env.PATH, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(event));
  });
}

export async function connected(page: Page, label: string) {
  const workspace = await startWorkspace(page, `${label} ${Date.now()}`);
  const credential = await connect(page, workspace.base, "coder");
  const env = { NODRAIL_URL: server, NODRAIL_CREDENTIAL: credential };
  return { ...workspace, credential, env };
}

export const shell = (command: string, id = `toolu_${randomUUID()}`) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
  tool_use_id: id,
});

export const expectDenied = (outcome: Outcome, text: string | RegExp) => {
  expect(outcome.code).toBe(0);
  const { hookSpecificOutput: answer } = JSON.parse(outcome.stdout) as {
    hookSpecificOutput: {
      permissionDecision: string;
      permissionDecisionReason: string;
    };
  };
  expect(answer.permissionDecision).toBe("deny");
  expect(answer.permissionDecisionReason).toMatch(text);
};
