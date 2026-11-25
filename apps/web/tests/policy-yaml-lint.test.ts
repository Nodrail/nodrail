import { describe, expect, test } from "vitest";
import {
  lintPolicyYaml,
  problemRanges,
  reviewProblems,
  sortProblems,
  type Problem,
} from "@/features/policies/yaml-lint";

const allowStatus = `- rule: Allow status
  command: git status
  effect: allow
`;

const problem = (over: Partial<Problem>): Problem => ({
  line: 1,
  column: 1,
  message: "Something",
  severity: "error",
  from: "editor",
  ...over,
});

describe("checking YAML as you type", () => {
  test("a valid file has no problems", () => {
    expect(lintPolicyYaml(allowStatus)).toEqual([]);
    expect(lintPolicyYaml("")).toEqual([]);
  });

  test("a YAML syntax error is an error on its line", () => {
    const [found] = lintPolicyYaml("- rule: A\n  effect: [allow\n");
    expect(found).toMatchObject({ severity: "error", from: "editor", line: 3 });
    expect(found?.message).toMatch(/Flow sequence/);
  });

  test("the engine's compile problems keep their place", () => {
    // The unknown key itself, on its own line, not the start of its rule.
    expect(lintPolicyYaml(`${allowStatus}  colour: red\n`)).toEqual([
      problem({
        line: 4,
        column: 3,
        message: 'rule: Unrecognized key: "colour"',
      }),
    ]);
    const twice = allowStatus + allowStatus.replace("git status", "git log");
    // A duplicate points at the second rule's name.
    expect(lintPolicyYaml(twice)).toEqual([
      problem({
        line: 4,
        column: 9,
        message:
          'rule "Allow status" is already defined at rules.yaml:1. Use override to change it.',
      }),
    ]);
    expect(lintPolicyYaml("- required_engine_version: 99\n")[0]?.message).toBe(
      "This file needs engine version 99; this is 5.",
    );
  });

  test("an unused list is a warning, not an error", () => {
    const text = `- list: tools\n  items: [a]\n${allowStatus}`;
    expect(lintPolicyYaml(text)).toEqual([
      problem({
        severity: "warning",
        column: 3,
        message: 'List "tools" is not used.',
      }),
    ]);
  });
});

describe("problems from both checks", () => {
  test("are in file order, errors first, each once", () => {
    const warning = problem({ severity: "warning", line: 2 });
    const error = problem({ line: 2, message: "Other" });
    const server = problem({ from: "server", line: 1 });
    expect(
      sortProblems([warning, error, server, problem({ line: 1 })]),
    ).toEqual([server, error, warning]);
  });

  test("the server's review names its issues and warnings", () => {
    expect(
      reviewProblems({
        issues: [{ line: 3, column: 3, message: 'Unknown agent "bot".' }],
        warnings: [{ line: 1, column: 1, message: "Careful." }],
      }),
    ).toEqual([
      problem({
        from: "server",
        line: 3,
        column: 3,
        message: 'Unknown agent "bot".',
      }),
      problem({ from: "server", severity: "warning", message: "Careful." }),
    ]);
  });
});

describe("where the editor underlines", () => {
  const text = "- rule: A\n  effect: maybe\n\n";

  test("the word at the line and column", () => {
    const [range] = problemRanges(text, [problem({ line: 2, column: 11 })]);
    expect(range).toEqual({
      from: 20,
      to: 25,
      severity: "error",
      message: "Something",
    });
    expect(text.slice(range?.from, range?.to)).toBe("maybe");
  });

  test("one character when there is no word", () => {
    const [range] = problemRanges(text, [problem({ line: 2, column: 2 })]);
    expect(text.slice(range?.from, range?.to)).toBe(" ");
  });

  test("an empty line is a point", () => {
    const [range] = problemRanges(text, [problem({ line: 3 })]);
    expect(range).toMatchObject({ from: 26, to: 26 });
  });

  test("positions from older text stay inside the document", () => {
    const [range] = problemRanges("ab", [problem({ line: 9, column: 40 })]);
    expect(range).toMatchObject({ from: 2, to: 2 });
  });
});
