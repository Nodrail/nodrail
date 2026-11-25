import { describe, expect, test } from "vitest";
import type { RuleDto } from "@/contracts/v1/policies";
import { conditionLabel, resourceLabel } from "@/contracts/v1/policies";
import {
  findOverlap,
  formatConditionValue,
  parseConditionValue,
  ruleFromForm,
} from "@/features/policies/form";

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("condition values", () => {
  test.each([
    ["eq", "true", true],
    ["eq", "false", false],
    ["gt", "12.5", 12.5],
    ["eq", "open", "open"],
    ["in", "a, 2, true", ["a", 2, true]],
    ["in", " , a", ["a"]],
  ] as const)("%s %j", (op, text, expected) => {
    expect(parseConditionValue(op, text)).toEqual(expected);
  });

  test("round-trips through the form", () => {
    expect(formatConditionValue(["a", 2])).toBe("a, 2");
    expect(parseConditionValue("in", formatConditionValue(["a", 2]))).toEqual([
      "a",
      2,
    ]);
  });
});

describe("ruleFromForm", () => {
  const base = {
    name: " Rule ",
    effect: "allow",
    agentKey: "",
    installationName: "",
    operation: "github.issues.list",
    resourceKind: "repository",
    resourceMatch: "exact",
    resourceValue: "acme/support",
    conditions: "[]",
    expiresOn: "",
  };

  test("splits the operation at the first dot", () => {
    expect(ruleFromForm(form(base))).toMatchObject({
      name: "Rule",
      toolKey: "github",
      operationKey: "issues.list",
      agentKey: null,
      expiresAt: null,
      resource: { kind: "repository", match: "exact", value: "acme/support" },
    });
  });

  test("drops the value when any resource matches", () => {
    expect(ruleFromForm(form({ ...base, resourceMatch: "any" }))).toMatchObject(
      { resource: { kind: "repository", match: "any" } },
    );
    expect(
      (
        ruleFromForm(form({ ...base, resourceMatch: "any" })) as {
          resource: object;
        }
      ).resource,
    ).not.toHaveProperty("value");
  });

  test("expires at the end of the chosen day", () => {
    expect(
      ruleFromForm(form({ ...base, expiresOn: "2026-12-08" })),
    ).toMatchObject({ expiresAt: "2026-12-08T23:59:59Z" });
  });

  test("broken conditions fail validation rather than being dropped", () => {
    expect(ruleFromForm(form({ ...base, conditions: "{nope" }))).toMatchObject({
      conditions: null,
    });
  });
});

describe("labels", () => {
  test.each([
    [{ kind: "repository", match: "any" }, "repository=*"],
    [{ kind: "repository", match: "exact", value: "a/b" }, "repository=a/b"],
    [{ kind: "repository", match: "prefix", value: "a/" }, "repository=a/*"],
  ] as const)("%j", (scope, expected) => {
    expect(resourceLabel(scope)).toBe(expected);
  });

  test("conditions read naturally", () => {
    expect(conditionLabel({ field: "amount", op: "gt", value: 0 })).toBe(
      "amount > 0",
    );
    expect(conditionLabel({ field: "x", op: "in", value: [1, 2] })).toBe(
      "x in 1, 2",
    );
  });
});

describe("findOverlap", () => {
  const rule = (overrides: Partial<RuleDto>) =>
    ({
      logicalRuleId: "a",
      status: "active",
      toolKey: "github",
      operationKey: "issues.list",
      agentKey: null,
      name: "Existing",
      ...overrides,
    }) as RuleDto;
  const draft = { operation: "github.issues.list", agentKey: "one" };

  test("finds a rule for the same operation and agent", () => {
    expect(findOverlap([rule({ agentKey: "one" })], draft)?.name).toBe(
      "Existing",
    );
  });

  test("workspace-wide rules overlap with any agent", () => {
    expect(findOverlap([rule({})], draft)).toBeTruthy();
  });

  test.each<[string, Partial<RuleDto>]>([
    ["another agent", { agentKey: "two" }],
    ["another operation", { operationKey: "issues.get" }],
    ["a revoked rule", { status: "revoked" }],
    ["the rule being edited", { logicalRuleId: "self" }],
  ])("ignores %s", (_label, overrides) => {
    expect(
      findOverlap([rule(overrides)], { ...draft, excludeId: "self" }),
    ).toBeUndefined();
  });

  test("an empty operation overlaps with nothing", () => {
    expect(
      findOverlap([rule({})], { operation: " ", agentKey: "" }),
    ).toBeUndefined();
  });
});
