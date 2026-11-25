import { describe, expect, test } from "vitest";
import { renderPolicies } from "@nodrail/policy-engine/yaml";
import { groupOutline, outlineItems } from "@/features/policies/yaml-outline";

describe("the YAML editor's groups", () => {
  test("lists each rule, gate and budget of a rendered file with its lines", () => {
    const text = renderPolicies({
      version: 2,
      rules: [
        {
          id: "read",
          name: "Read issues",
          effect: "allow",
          agentKey: null,
          installationName: null,
          toolKey: "github",
          operationKey: "issues.list",
          resource: { kind: "repository", match: "any" },
          conditions: [],
          expiresAt: null,
        },
      ],
      gates: [
        {
          id: "qa",
          name: "QA first",
          effect: "deny",
          agentKey: null,
          installationName: null,
          toolKey: "github",
          operationKey: "pr.create",
          resource: { kind: "repository", match: "any" },
          conditions: [],
          expiresAt: null,
          requires: [{ agent: "qa", verdicts: ["pass"], since: [] }],
        },
      ],
      budgets: [
        {
          id: "calls",
          name: "Calls per run",
          agent: null,
          per: "run",
          metric: "tool_calls",
          limit: 60,
          warnAt: null,
          effect: "deny",
        },
      ],
    });
    const items = outlineItems(text);
    expect(items.map(({ kind, name }) => [kind, name])).toEqual([
      ["rule", "Read issues"],
      ["gate", "QA first"],
      ["budget", "Calls per run"],
    ]);
    const lines = text.split("\n");
    for (const item of items) {
      expect(lines[item.line - 1]).toMatch(/^- /);
      expect(item.endLine).toBeGreaterThan(item.line);
      // The next entry, or the end, follows the last line.
      expect(lines[item.endLine] ?? "").not.toMatch(/^ {2}\S/);
    }
    expect(items[0]?.effect).toBe("allow");
    expect(items[1]?.effect).toBeUndefined();
    expect(groupOutline(items).map((group) => group.items.length)).toEqual([
      1, 1, 1,
    ]);
  });

  test("reads hand-written entries, quotes and comments, and skips the rest", () => {
    const text = `# team rules
- required_engine_version: 3
- id: one
  rule: "Deploy: prod" # careful

- list: reviewers
  items: [qa]
-
  gate: 'Wait for QA'
  requires: [{ agent: qa, verdict: pass }]
`;
    expect(
      outlineItems(text).map(({ kind, name, line, endLine }) => [
        kind,
        name,
        line,
        endLine,
      ]),
    ).toEqual([
      ["rule", "Deploy: prod", 3, 4],
      ["gate", "Wait for QA", 8, 10],
    ]);
  });
});
