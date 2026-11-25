import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  evaluate,
  type Descriptor,
  type EvaluatedRule,
} from "@/server/modules/policies/evaluator";

const now = new Date("2026-11-08T12:00:00Z");

const descriptor: Descriptor = {
  agentId: "agent-a",
  installationId: "install-a",
  toolKey: "github",
  operationKey: "issues.delete",
  resourceKind: "repository",
  resourceId: "acme/support",
  params: { issue: 482, labels: ["resolved"], nested: { count: 3 } },
};

let counter = 0;
function rule(overrides: Partial<EvaluatedRule> = {}): EvaluatedRule {
  counter += 1;
  return {
    logicalRuleId: `rule-${counter}`,
    agentId: null,
    installationId: null,
    toolKey: "github",
    operationKey: "issues.delete",
    effect: "allow",
    resource: { kind: "repository", match: "any" },
    conditions: [],
    expiresAt: null,
    ...overrides,
  };
}

const outcome = (rules: EvaluatedRule[], target = descriptor) =>
  evaluate(target, rules, now).outcome;

describe("what a rule matches", () => {
  test("no rule means no decision", () => {
    expect(evaluate(descriptor, [], now)).toEqual({
      outcome: "none",
      matchedRuleId: null,
    });
  });

  test("reports which rule decided", () => {
    const winner = rule();
    expect(evaluate(descriptor, [winner], now).matchedRuleId).toBe(
      winner.logicalRuleId,
    );
  });

  test.each<[string, Partial<EvaluatedRule>]>([
    ["another agent", { agentId: "agent-b" }],
    ["another installation", { installationId: "install-b" }],
    ["another tool", { toolKey: "linear" }],
    ["another operation", { operationKey: "issues.list" }],
    ["another resource kind", { resource: { kind: "issue", match: "any" } }],
    [
      "another exact resource",
      { resource: { kind: "repository", match: "exact", value: "acme/docs" } },
    ],
    [
      "a different prefix",
      { resource: { kind: "repository", match: "prefix", value: "other/" } },
    ],
    ["an expired rule", { expiresAt: new Date("2026-11-08T11:59:59Z") }],
    ["expiring this instant", { expiresAt: now }],
  ])("%s does not match", (_label, overrides) => {
    expect(outcome([rule(overrides)])).toBe("none");
  });

  test.each<[string, Partial<EvaluatedRule>]>([
    ["this agent", { agentId: "agent-a" }],
    ["this installation", { installationId: "install-a" }],
    [
      "this exact resource",
      {
        resource: { kind: "repository", match: "exact", value: "acme/support" },
      },
    ],
    [
      "a matching prefix",
      { resource: { kind: "repository", match: "prefix", value: "acme/" } },
    ],
    ["a future expiry", { expiresAt: new Date("2026-11-08T12:00:01Z") }],
  ])("%s matches", (_label, overrides) => {
    expect(outcome([rule(overrides)])).toBe("allow");
  });
});

describe("conditions", () => {
  test.each([
    ["eq", "issue", 482, true],
    ["eq", "issue", 1, false],
    ["neq", "issue", 1, true],
    ["gt", "issue", 481, true],
    ["gt", "issue", 482, false],
    ["gte", "issue", 482, true],
    ["lt", "issue", 483, true],
    ["lte", "issue", 482, true],
    ["lte", "issue", 481, false],
    ["in", "issue", [1, 482], true],
    ["in", "issue", [1, 2], false],
    ["contains", "labels", "resolved", true],
    ["contains", "labels", "open", false],
    ["eq", "nested.count", 3, true],
  ] as const)("%s on %s with %j", (op, field, value, expected) => {
    const result = outcome([
      rule({ conditions: [{ field, op, value: value as never }] }),
    ]);
    expect(result).toBe(expected ? "allow" : "none");
  });

  test("every condition must hold", () => {
    expect(
      outcome([
        rule({
          conditions: [
            { field: "issue", op: "eq", value: 482 },
            { field: "issue", op: "eq", value: 1 },
          ],
        }),
      ]),
    ).toBe("none");
  });

  test("numeric comparison never coerces text", () => {
    expect(
      outcome(
        [rule({ conditions: [{ field: "amount", op: "gt", value: 1 }] })],
        { ...descriptor, params: { amount: "5" } },
      ),
    ).toBe("none");
  });

  test("a missing parameter stops an allow but not a deny", () => {
    const condition = { field: "absent", op: "eq", value: 1 } as const;
    expect(outcome([rule({ conditions: [condition] })])).toBe("none");
    expect(outcome([rule({ effect: "deny", conditions: [condition] })])).toBe(
      "deny",
    );
  });
});

describe("precedence, for any combination of rules", () => {
  const effect = fc.constantFrom("deny", "allow") as fc.Arbitrary<
    EvaluatedRule["effect"]
  >;
  const someRules = fc.array(
    effect.map((value) => rule({ effect: value })),
    { minLength: 1, maxLength: 25 },
  );

  test("deny wins whenever one matches", () => {
    fc.assert(
      fc.property(someRules, (rules) => {
        fc.pre(rules.some((item) => item.effect === "deny"));
        expect(outcome(rules)).toBe("deny");
      }),
    );
  });

  test("allow decides when nothing denies", () => {
    fc.assert(
      fc.property(someRules, (rules) => {
        fc.pre(!rules.some((item) => item.effect === "deny"));
        expect(outcome(rules)).toBe("allow");
      }),
    );
  });

  test("the order rules were written in never matters", () => {
    fc.assert(
      fc.property(
        someRules.chain((rules) =>
          fc.tuple(
            fc.constant(rules),
            fc.shuffledSubarray(rules, {
              minLength: rules.length,
            }),
          ),
        ),
        ([rules, shuffled]) => {
          expect(evaluate(descriptor, shuffled, now)).toEqual(
            evaluate(descriptor, rules, now),
          );
        },
      ),
    );
  });

  test("rules for other agents or tools can never decide", () => {
    fc.assert(
      fc.property(
        fc.array(
          effect.map((value) =>
            rule({ effect: value, agentId: "someone-else" }),
          ),
          { maxLength: 25 },
        ),
        (rules) => {
          expect(outcome(rules)).toBe("none");
        },
      ),
    );
  });

  test("an allow never survives an added deny", () => {
    fc.assert(
      fc.property(someRules, (rules) => {
        expect(outcome([...rules, rule({ effect: "deny" })])).toBe("deny");
      }),
    );
  });
});

describe("parameters of the wrong kind", () => {
  const review = rule({
    effect: "deny",
    conditions: [{ field: "amount", op: "gt", value: 1000 }],
  });
  const allow = rule();
  const withAmount = (amount: unknown) => ({
    ...descriptor,
    params: { amount } as Descriptor["params"],
  });

  test.each([["5000"], [[5000]], [{ value: 5000 }], [true], [null]])(
    "%j cannot dodge a deny rule",
    (amount) => {
      expect(outcome([allow, review], withAmount(amount))).toBe("deny");
    },
  );

  test("a real number below the line is not denied", () => {
    expect(outcome([allow, review], withAmount(5))).toBe("allow");
  });

  test.each([[["prod"]], [1], [null]])(
    "%j cannot satisfy an allow rule on not-equal",
    (env) => {
      const only = rule({
        conditions: [{ field: "env", op: "neq", value: "prod" }],
      });
      expect(
        outcome([only], {
          ...descriptor,
          params: { env } as Descriptor["params"],
        }),
      ).toBe("none");
    },
  );

  test("a deny rule applies to a value it cannot judge", () => {
    const deny = rule({
      effect: "deny",
      conditions: [{ field: "amount", op: "lt", value: 10 }],
    });
    expect(outcome([allow, deny], withAmount("1"))).toBe("deny");
  });

  test("in and contains accept the right kinds", () => {
    const within = rule({
      conditions: [{ field: "amount", op: "in", value: [1, 2] }],
    });
    expect(outcome([within], withAmount(2))).toBe("allow");
    expect(outcome([within], withAmount("2"))).toBe("none");
    const has = rule({
      conditions: [{ field: "labels", op: "contains", value: "resolved" }],
    });
    expect(outcome([has])).toBe("allow");
  });
});
