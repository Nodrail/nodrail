import { describe, expect, test } from "vitest";
import {
  claudeCodeSettings,
  governedTools,
} from "@/features/agents/setup-snippets";

const pattern = new RegExp(governedTools);

describe("the Claude Code settings", () => {
  test.each([
    "Bash",
    "PowerShell",
    "Write",
    "Edit",
    "MultiEdit",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "mcp__github__create_issue",
    "Monitor",
    "SomeToolAddedNextYear",
  ])("govern %s", (tool) => {
    expect(pattern.test(tool)).toBe(true);
  });

  test.each(["Read", "Glob", "Grep", "TodoWrite"])("leave %s alone", (tool) => {
    expect(pattern.test(tool)).toBe(false);
  });

  test("block the tool if the check itself fails", () => {
    const [entry] = claudeCodeSettings("run").hooks.PreToolUse;
    expect(entry?.hooks[0]).toMatchObject({
      onFailure: "block",
      timeout: 30,
      command: "run",
    });
  });
});
