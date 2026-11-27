import { describe, expect, test } from "vitest";
import type {
  PolicyBudget,
  PolicyGate,
  Requirement,
} from "@nodrail/policy-engine";
import {
  computeReport,
  type ReportAction,
  type ReportInput,
  type ReportStep,
} from "@/server/modules/reports/compute";
import { expectedReport } from "./support/report-fixture";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute));

const gate = (
  id: string,
  name: string,
  target: string,
  requires: PolicyGate["requires"],
  effect: PolicyGate["effect"],
): PolicyGate => ({
  id,
  name,
  effect,
  agentKey: null,
  installationName: null,
  toolKey: "claude-code",
  operationKey: "agent",
  resource: { kind: "agent", match: "exact", value: target },
  conditions: [],
  expiresAt: null,
  requires,
});

const builders = ["dev", "infra"];
const gates = [
  gate(
    "review",
    "Review before the pull request",
    "github",
    [
      { agent: "qa", verdicts: ["pass"], since: builders },
      {
        agent: "reviewer",
        verdicts: ["ship", "ship_with_debt"],
        since: builders,
      },
    ],
    "deny",
  ),
  gate(
    "deploy",
    "QA before a deploy",
    "deploy",
    [{ agent: "qa", verdicts: ["pass"], since: [] }],
    "deny",
  ),
];

const budgets: PolicyBudget[] = [
  {
    id: "budget",
    name: "Builder step",
    agent: "dev",
    per: "step",
    metric: "tool_calls",
    limit: 2,
    warnAt: null,
    effect: "deny",
  },
];

let counter = 0;

/** A step that started and finished at these minutes; null for not yet. */
function step(
  runId: string,
  agent: string,
  [start, finish]: [number | null, number | null],
  verdict: string | null = null,
  spend: { usd: number; tokens: number } | null = null,
): ReportStep {
  counter += 1;
  return {
    runId,
    stepKey: `${agent}-${counter}`,
    agent,
    startedAt: start === null ? null : at(start),
    finishedAt: finish === null ? null : at(finish),
    verdict,
    usd: spend?.usd ?? null,
    tokens: spend?.tokens ?? null,
  };
}

/** A dispatch of a subagent, as the hook sends it. */
function action(
  runId: string,
  minute: number,
  target: string,
  more: Partial<ReportAction> = {},
): ReportAction {
  counter += 1;
  return {
    id: `action-${counter}`,
    runId,
    decidedBy: "server",
    at: at(minute),
    agent: "main",
    descriptor: {
      agentId: "agent-1",
      installationId: "installation-1",
      toolKey: "claude-code",
      operationKey: "agent",
      resourceKind: "agent",
      resourceId: target,
      params: { subagent_type: target },
    },
    hold: null,
    ...more,
  };
}

const held = (id: string, missing: Requirement[]) => ({
  hold: { kind: "gate" as const, id, missing },
});

const qaPass = { agent: "qa", verdicts: ["pass"], since: builders };
const reviewed = {
  agent: "reviewer",
  verdicts: ["ship", "ship_with_debt"],
  since: builders,
};

const runs = ["a", "b", "c", "d", "e"].map((id) => ({ id, key: `feat/${id}` }));

const steps: ReportStep[] = [
  step("a", "dev", [1, 2], "done", { usd: 1.5, tokens: 1000 }),
  step("a", "qa", [3, 4], "fail", { usd: 0.5, tokens: 200 }),
  step("a", "dev", [6, 7], "done"),
  step("a", "qa", [8, 9], "pass"),
  step("a", "qa", [10, 11], "fail"),
  step("a", "dev", [12, 13], "done"),
  step("a", "qa", [14, 15], "pass"),
  step("a", "reviewer", [16, 17], "ship"),
  step("b", "qa", [1, 2], "pass"),
  step("b", "dev", [3, 5]),
  step("b", "qa", [7, 8], "fail"),
  step("c", "qa", [1, 2], "fail"),
  step("c", "dev", [3, 4], "done", { usd: 2, tokens: 3000 }),
  step("c", "qa", [5, 6], "PASS"),
  step("c", "reviewer", [7, 8], "ship_with_debt"),
  step("d", "infra", [2, null]),
];

const dev = { agent: "dev" };
const actions: ReportAction[] = [
  action("a", 5, "github", held("review", [qaPass, reviewed])),
  action("a", 18, "github"),
  action("b", 4, "helper", dev),
  action("b", 4, "helper", dev),
  action("b", 4, "helper", { ...dev, hold: { kind: "budget", id: "budget" } }),
  action("b", 6, "deploy"),
  action("b", 9, "github", held("review", [qaPass, reviewed])),
  action("c", 9, "github"),
  action("d", 1, "deploy", held("deploy", [{ ...qaPass, since: [] }])),
  action("e", 1, "helper"),
  // Held by a gate the current rules no longer have: reported nowhere.
  action("e", 2, "old", held("retired", [])),
];

const input: ReportInput = { runs, steps, actions, gates, budgets };

describe("reports", () => {
  test("match the hand-counted fixture", () => {
    expect(computeReport(input)).toEqual(expectedReport);
  });

  test("an empty window reports zeros and no median", () => {
    const report = computeReport({
      ...input,
      runs: [],
      steps: [],
      actions: [],
    });
    expect(
      report.gates.map(({ checked, firstPass }) => ({ checked, firstPass })),
    ).toEqual([
      { checked: 0, firstPass: { count: 0, of: 0 } },
      { checked: 0, firstPass: { count: 0, of: 0 } },
    ]);
    expect(report.budgets).toEqual([
      { id: "budget", name: "Builder step", hits: 0, runs: [] },
    ]);
    expect(report.agents).toEqual([]);
    expect(report.runs).toEqual({
      count: 0,
      medianSteps: null,
      withoutHold: { count: 0, of: 0 },
      reworkLoops: 0,
      withRework: 0,
      spend: { usd: 0, tokens: 0 },
    });
    expect(report.checks).toEqual([]);
    expect(report.topRuns).toEqual([]);
  });

  test("without gates nothing is checked, sent back or contradicted", () => {
    const report = computeReport({ ...input, gates: [] });
    expect(report.gates).toEqual([]);
    expect(report.runs.withoutHold).toEqual({ count: 0, of: 0 });
    for (const agent of report.agents) {
      expect(agent.backSteps).toBe(0);
      expect(agent.contradictedPasses).toBe(0);
    }
    expect(report.agents.find((row) => row.agent === "qa")?.steps).toBe(8);
    expect(report.checks).toEqual([]);
    expect(report.runs.reworkLoops).toBe(0);
  });

  test("a rework loop is one builder start per rejection, whoever rejected", () => {
    const report = computeReport({
      ...input,
      runs: [{ id: "x", key: "feat/x" }],
      steps: [
        step("x", "dev", [1, 2], "done"),
        step("x", "qa", [3, 4], "fail"),
        step("x", "reviewer", [3, 5], "changes"),
        // Two rejections, one builder start after them: one loop.
        step("x", "dev", [6, 7], "done"),
        // Infra is a builder too, but nothing failed since dev started.
        step("x", "infra", [8, 9], "done"),
        step("x", "qa", [10, 11], "pass"),
      ],
      actions: [],
    });
    expect(report.runs).toMatchObject({ reworkLoops: 1, withRework: 1 });
    expect(report.checks).toEqual([
      { agent: "qa", runs: 1, firstTry: 0, eventually: 1 },
      { agent: "reviewer", runs: 1, firstTry: 0, eventually: 0 },
    ]);
  });

  test("spend adds what receipts reported, to the cent", () => {
    const report = computeReport({
      ...input,
      runs: [{ id: "x", key: "feat/x" }],
      steps: [
        step("x", "dev", [1, 2], "done", { usd: 0.1, tokens: 10 }),
        step("x", "dev", [3, 4], "done", { usd: 0.2, tokens: 0 }),
        step("x", "qa", [5, 6], "pass"),
      ],
      actions: [],
    });
    expect(report.runs.spend).toEqual({ usd: 0.3, tokens: 10 });
    expect(report.topRuns).toEqual([
      {
        id: "x",
        key: "feat/x",
        steps: 3,
        reworkLoops: 0,
        spend: { usd: 0.3, tokens: 10 },
      },
    ]);
  });

  test("a back-step needs the check to finish between the agent's two steps", () => {
    const report = computeReport({
      ...input,
      steps: [
        step("x", "dev", [1, 2], "done"),
        step("x", "qa", [3, 6], "fail"),
        // Started before qa finished: not sent back by it.
        step("x", "dev", [4, 5], "done"),
        step("x", "reviewer", [7, 8], "changes"),
        step("x", "dev", [9, 10], "done"),
      ],
    });
    expect(report.agents.find((row) => row.agent === "dev")?.backSteps).toBe(1);
  });

  test("an action by a builder between a pass and a fail is work", () => {
    const report = computeReport({
      ...input,
      steps: [
        step("x", "qa", [1, 2], "pass"),
        step("x", "dev", [null, null]),
        step("x", "qa", [5, 6], "fail"),
      ],
      actions: [action("x", 3, "helper", dev)],
    });
    const qa = report.agents.find((row) => row.agent === "qa");
    expect(qa?.contradictedPasses).toBe(0);
  });

  test("a later step with no verdict takes nothing back", () => {
    const report = computeReport({
      ...input,
      steps: [step("x", "qa", [1, 2], "pass"), step("x", "qa", [3, 4])],
      actions: [],
    });
    expect(report.agents).toMatchObject([
      { agent: "qa", contradictedPasses: 0, withoutReceipt: 1 },
    ]);
  });

  test("an even number of runs takes the mean of the middle two", () => {
    const report = computeReport({ ...input, runs: runs.slice(0, 4) });
    // a, b, c, d: 8, 3, 4, 1 steps.
    expect(report.runs.medianSteps).toBe(3.5);
  });
});
