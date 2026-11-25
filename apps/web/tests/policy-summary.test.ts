import { describe, expect, test } from "vitest";
import type { PolicyBudget, RunEvent } from "@nodrail/policy-engine";
import {
  impactText,
  ruleSummary,
  type RuleDraft,
} from "@/features/policies/summary";
import { contextAt } from "@/server/modules/policies/recent";
import { peakIn } from "@/server/modules/policies/usage";

const draft = (overrides: Partial<RuleDraft> = {}): RuleDraft => ({
  name: "Read support issues",
  effect: "allow",
  agentKey: null,
  installationName: null,
  toolKey: "github",
  operationKey: "issues.list",
  resource: { kind: "repository", match: "exact", value: "acme/support" },
  conditions: [],
  expiresAt: null,
  ...overrides,
});

describe("ruleSummary", () => {
  test("says what an allow rule does, where, and until when", () => {
    expect(ruleSummary(draft(), "Development")).toBe(
      "Allows every agent to run github.issues.list on acme/support in Development, until revoked.",
    );
  });

  test("names a scoped agent, its installation, conditions and the expiry", () => {
    expect(
      ruleSummary(
        draft({
          effect: "deny",
          agentKey: "deploy-bot",
          installationName: "ci",
          resource: { kind: "repository", match: "prefix", value: "acme/" },
          conditions: [{ field: "amount", op: "lte", value: 100 }],
          expiresAt: "2026-12-31T23:59:59Z",
        }),
        "Production",
      ),
    ).toBe(
      "Denies deploy-bot (installation ci) github.issues.list on any repository starting with acme/ when amount ≤ 100 in Production, until 2026-12-31.",
    );
  });

  test("a deny rule, on any resource", () => {
    expect(
      ruleSummary(
        draft({ effect: "deny", resource: { kind: "issue", match: "any" } }),
        "Development",
      ),
    ).toBe(
      "Denies every agent github.issues.list on any issue in Development, until revoked.",
    );
  });

  test("waits for a decision, and fills gaps while typing", () => {
    expect(ruleSummary(draft({ effect: "" }), "Development")).toBeNull();
    expect(
      ruleSummary(
        draft({
          toolKey: "",
          operationKey: "",
          resource: { kind: "", match: "exact", value: "" },
        }),
        "Development",
      ),
    ).toBe(
      "Allows every agent to run the operation on the resource you name in Development, until revoked.",
    );
  });
});

describe("impactText", () => {
  const impact = {
    days: 7,
    actions: 40,
    sampled: false,
    matched: 12,
    changed: 3,
    runs: 0,
    withoutRun: 0,
  };

  test("a rule or gate: matched, and decided differently", () => {
    expect(impactText("rule", impact, "Development")).toBe(
      "Of 40 actions in the last 7 days, it would have matched 12; 3 actions would have been decided differently.",
    );
    expect(
      impactText("gate", { ...impact, changed: 0, sampled: true }, "Dev"),
    ).toBe(
      "Of the latest 40 actions in the last 7 days, it would have matched 12; none would have been decided differently.",
    );
  });

  test("a budget: runs over its limit", () => {
    expect(
      impactText("budget", { ...impact, matched: 1, runs: 1, changed: 1 }, "D"),
    ).toBe(
      "Of 40 actions in the last 7 days, it would have been over its limit for 1 in 1 run; 1 action would have been decided differently.",
    );
    // Outside a run there is nothing to count in, so the budget holds.
    expect(
      impactText(
        "budget",
        { ...impact, matched: 5, runs: 2, withoutRun: 2, changed: 5 },
        "D",
      ),
    ).toBe(
      "Of 40 actions in the last 7 days, it would have been over its limit for 3 in 2 runs, and held 2 taken outside any run; 5 actions would have been decided differently.",
    );
  });

  test("nothing recorded, or nothing to check yet", () => {
    expect(impactText("rule", { ...impact, actions: 0 }, "Production")).toBe(
      "No actions were recorded in Production in the last 7 days, so there is nothing to compare yet.",
    );
    expect(impactText("rule", null, "Production")).toContain("Fill in");
  });
});

const at = "2026-11-15T10:00:00.000Z";
const action = (step: string | null, agent = "dev"): RunEvent => ({
  type: "action",
  step,
  agent,
  at,
  tool: "github",
  operation: "pr.create",
  outcome: "allow",
  change: false,
});
const events: RunEvent[] = [
  { type: "step.started", step: "s1", agent: "dev", at },
  action("s1"),
  action("s1"),
  { type: "step.started", step: "s2", agent: "qa", at },
  action("s2", "qa"),
  action(null, "main"),
];

describe("contextAt", () => {
  test("the run as it was just before its nth action, with that action's step", () => {
    expect(contextAt("feat/x", events, 0)).toEqual({
      run: "feat/x",
      step: { id: "s1", agent: "dev" },
      events: events.slice(0, 1),
    });
    expect(contextAt("feat/x", events, 2)?.step).toEqual({
      id: "s2",
      agent: "qa",
    });
    expect(contextAt("feat/x", events, 3)).toMatchObject({
      step: null,
      events: events.slice(0, 5),
    });
    expect(contextAt("feat/x", events, 4)).toBeNull();
  });
});

describe("peakIn", () => {
  const budget = (overrides: Partial<PolicyBudget> = {}): PolicyBudget => ({
    id: "b",
    name: "Calls",
    agent: null,
    per: "run",
    metric: "tool_calls",
    limit: 3,
    warnAt: null,
    effect: "deny",
    ...overrides,
  });

  test("the most a budget counted when an action was checked", () => {
    expect(peakIn(budget(), "k", events)).toBe(4);
    expect(peakIn(budget({ per: "step", agent: "dev" }), "k", events)).toBe(2);
    expect(peakIn(budget({ per: "step", agent: "infra" }), "k", events)).toBe(
      null,
    );
  });
});
