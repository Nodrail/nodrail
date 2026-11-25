import { describe, expect, test } from "vitest";
import {
  readWorkspace,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import type { ImpactChange } from "@/contracts/v1/policy-impact";
import type { BudgetInput, GateInput } from "@/contracts/v1/runs";
import { createRule } from "@/server/modules/policies";
import { previewImpact } from "@/server/modules/policies/impact";
import { policySuggestions } from "@/server/modules/policies/suggestions";
import { budgetUsage, ruleLastMatched } from "@/server/modules/policies/usage";
import { activeRunPolicy } from "@/server/modules/runs/policy";
import { ENV, dispatch, rig, work } from "./runs-world";
import {
  addMember,
  ruleBody,
  submitIssue,
  useDatabase,
  workspaceWithToken,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const read = <T>(
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
  person: Person = w.owner,
) => readWorkspace(person, w.id, run);

const preview = (w: TestWorkspace, change: ImpactChange, person?: Person) =>
  read(w, (context) => previewImpact(context, ENV, change), person);

/** The rule submitIssue's requests would match: issues.create on acme/app. */
const issueRule = (effect: "allow" | "deny" = "allow", value = "acme/app") =>
  ruleBody({
    name: "Create issues",
    effect,
    toolKey: "github",
    operationKey: "issues.create",
    resource: { kind: "repository", match: "exact", value },
  });

describe("impact preview of a rule", () => {
  test("counts what it covers and what it decides differently", async () => {
    const { w, token } = await workspaceWithToken();
    for (let index = 0; index < 3; index += 1) await submitIssue(token);
    const rule = (entry: unknown, id: string | null = null) =>
      preview(w, { kind: "rule", id, entry });

    // The agent's seeded request (issues.delete) is the fourth action.
    expect(await rule(issueRule())).toEqual({
      days: 7,
      actions: 4,
      sampled: false,
      matched: 3,
      changed: 3,
      runs: 0,
      withoutRun: 0,
    });
    expect(await rule(issueRule("allow", "acme/other"))).toMatchObject({
      actions: 4,
      matched: 0,
      changed: 0,
    });

    // Editing a live rule compares with that rule as it is now.
    const created = await withWorkspace(w.owner, w.id, (context) =>
      createRule(context, ENV, issueRule()),
    );
    const id = created.logicalRuleId;
    expect(await rule(issueRule(), id)).toMatchObject({
      matched: 3,
      changed: 0,
    });
    expect(await rule(issueRule("deny"), id)).toMatchObject({
      matched: 3,
      changed: 3,
    });
  });

  test("an incomplete form has no preview, and only policy managers ask", async () => {
    const { w } = await workspaceWithToken();
    expect(
      await preview(w, { kind: "rule", id: null, entry: { name: "x" } }),
    ).toBeNull();
    // An agent that is not there yet can't be matched either.
    expect(
      await preview(w, {
        kind: "rule",
        id: null,
        entry: { ...issueRule(), agentKey: "nobody" },
      }),
    ).toBeNull();
    await expect(
      preview(w, { kind: "rule", id: "Not an id!", entry: issueRule() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const viewer = await addMember(w, "viewer");
    await expect(
      preview(w, { kind: "rule", id: null, entry: issueRule() }, viewer),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

const docsGate: GateInput = {
  name: "QA before docs",
  agentKey: null,
  toolKey: "claude-code",
  operationKey: "agent",
  resource: { kind: "agent", match: "exact", value: "docs" },
  requires: [{ agent: "qa", verdicts: ["pass"], since: [] }],
  effect: "deny",
};

describe("impact preview of a gate and a budget", () => {
  test("a gate holds only where the run is missing its steps", async () => {
    const { w, token } = await rig();
    await dispatch(token, "docs", { key: "feat/unchecked" });
    await work(token, "feat/checked", "qa", "pass");
    await dispatch(token, "docs", { key: "feat/checked" });
    await dispatch(token, "helper", { key: "feat/checked" });

    expect(
      await preview(w, { kind: "gate", id: null, entry: docsGate }),
      // With the agent's seeded request outside any run, four actions.
    ).toMatchObject({ actions: 4, matched: 2, changed: 1, runs: 0 });

    // A live gate edited in place keeps its id; moved onto docs, it now
    // covers the same two actions.
    const { gates } = await read(w, (context) => activeRunPolicy(context, ENV));
    const live = gates.find((gate) => gate.name === "QA before a deploy");
    expect(
      await preview(w, {
        kind: "gate",
        id: live?.id ?? null,
        entry: { ...docsGate, name: "QA before a deploy" },
      }),
    ).toMatchObject({ matched: 2, changed: 1 });
  });

  test("a budget counts the runs that would have gone over it", async () => {
    const { w, token } = await rig();
    await dispatch(token, "helper", { key: "feat/one" });
    await dispatch(token, "helper", { key: "feat/two" });
    await dispatch(token, "helper", { key: "feat/two" });
    const budget: BudgetInput = {
      name: "One call per run",
      agent: null,
      per: "run",
      metric: "tool_calls",
      limit: 1,
      warnAt: null,
      effect: "deny",
    };
    expect(
      await preview(w, { kind: "budget", id: null, entry: budget }),
    ).toEqual({
      days: 7,
      actions: 4,
      sampled: false,
      // The second call of feat/two, and the agent's seeded request: outside
      // any run, a budget has nothing to count in and holds it.
      matched: 2,
      changed: 2,
      runs: 1,
      withoutRun: 1,
    });
    expect(
      await preview(w, {
        kind: "budget",
        id: null,
        entry: { ...budget, limit: 5 },
      }),
    ).toMatchObject({ matched: 1, changed: 1, runs: 0, withoutRun: 1 });
  });
});

describe("usage beside the lists", () => {
  test("a budget's peak, the runs it counted in, and the runs it held", async () => {
    const { w, token } = await rig();
    const run = { key: "feat/busy", step: { id: "d1", agent: "dev" } };
    for (let index = 0; index < 3; index += 1)
      await dispatch(token, "helper", run);
    await dispatch(token, "helper", {
      key: "feat/calm",
      step: { id: "d2", agent: "dev" },
    });
    await dispatch(token, "helper", { key: "feat/main" });
    const usage = await read(w, (context) => budgetUsage(context, ENV));
    const { budgets } = await read(w, (context) =>
      activeRunPolicy(context, ENV),
    );
    const builder = budgets.find((budget) => budget.name === "Builder step");
    expect(usage[builder?.id ?? ""]).toEqual({ peak: 3, runs: 2, held: 1 });
  });

  test("when each rule last decided an action", async () => {
    const { w, token } = await workspaceWithToken();
    const created = await withWorkspace(w.owner, w.id, (context) =>
      createRule(context, ENV, issueRule("deny")),
    );
    const before = await read(w, (context) => ruleLastMatched(context, ENV));
    expect(before).toEqual({});
    expect((await submitIssue(token)).code).toBe("DENIED");
    const after = await read(w, (context) => ruleLastMatched(context, ENV));
    expect(Object.keys(after)).toEqual([created.logicalRuleId]);
    const age = Date.now() - Date.parse(after[created.logicalRuleId] ?? "");
    expect(age).toBeGreaterThanOrEqual(0);
    expect(age).toBeLessThan(60_000);
  });

  test("suggestions name what this environment has seen", async () => {
    const { w, token } = await rig();
    await submitIssue(token);
    await work(token, "feat/s", "qa", "pass");
    await work(token, "feat/s", "dev");
    expect(await read(w, (context) => policySuggestions(context, ENV))).toEqual(
      {
        // With the agent's seeded request; equally used, so by name.
        operations: ["github.issues.create", "github.issues.delete"],
        resources: [
          { kind: "issue", values: ["acme/support#482"] },
          { kind: "repository", values: ["acme/app"] },
        ],
        stepAgents: expect.arrayContaining(["qa", "dev"]),
        verdicts: ["pass"],
      },
    );
  });
});
