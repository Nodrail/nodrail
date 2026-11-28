import { describe, expect, test } from "vitest";
import { compilePolicies } from "@nodrail/sdk/yaml";
import {
  readWorkspace,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import { PolicyVersion } from "@/server/db/entities";
import { createRule, listRules } from "@/server/modules/policies";
import { activeRunPolicy } from "@/server/modules/runs/policy";
import type {
  BudgetInput,
  GateInput,
  RunPolicyChange,
} from "@/contracts/v1/runs";
import { changeRunPolicy } from "@/server/modules/policies/run-policy-changes";
import {
  applyPolicyFile,
  exportPolicyFile,
  previewPolicyFile,
  readPolicyFile,
} from "@/server/modules/policies/rule-files";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  ruleBody,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const ENV = "development";

const act = <T>(
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
  person: Person = w.owner,
) => withWorkspace(person, w.id, run);

const preview = (w: TestWorkspace, text: unknown, person?: Person) =>
  act(w, (context) => previewPolicyFile(context, ENV, text), person);

const apply = (
  w: TestWorkspace,
  text: unknown,
  expected: { revision: number; fileDigest: string },
) => act(w, (context) => applyPolicyFile(context, ENV, text, expected));

const previewed = async (w: TestWorkspace, text: unknown) => {
  const { policyRevision, fileDigest } = await preview(w, text);
  return { revision: policyRevision, fileDigest };
};

/** Previews and applies, as the page does. */
async function publish(w: TestWorkspace, text: string) {
  return apply(w, text, await previewed(w, text));
}

const rule = (name: string, effect = "allow", extra = "") => `
- rule: ${name}
  tool: github
  operation: issues.delete
  resource: { kind: issue, match: any }
  effect: ${effect}
${extra}`;

const names = async (w: TestWorkspace) =>
  (await act(w, (context) => listRules(context, ENV))).rules
    .filter((item) => item.status !== "revoked")
    .map((item) => item.name)
    .sort();

const versions = (w: TestWorkspace) =>
  admin
    .getRepository(PolicyVersion)
    .countBy({ workspaceId: w.id, environmentId: w.environmentId });

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("previewing a rules file", () => {
  test("says what would change and changes nothing", async () => {
    const w = await createWorkspace();
    const before = await versions(w);
    expect(await preview(w, rule("One"))).toMatchObject({
      issues: [],
      added: ["One"],
      changed: [],
      removed: [],
      unchanged: 0,
    });
    expect(await versions(w)).toBe(before);
    expect(await names(w)).toEqual([]);
  });

  test("reports problems with their lines", async () => {
    const w = await createWorkspace();
    const { issues } = await preview(w, "- rule: Bad\n  effect: maybe\n");
    expect(issues[0]?.line).toBe(1);
  });

  test.each([
    ["an agent", "  agent: ghost", 'No agent called "ghost"'],
    [
      "an installation",
      "  agent: bot\n  installation: ghost",
      "No installation",
    ],
  ])("names %s that does not exist", async (_label, extra, message) => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const { issues } = await preview(w, rule("One", "allow", extra));
    expect(issues[0]?.message).toContain(message);
    expect(issues[0]?.line).toBe(2);
  });

  test("imports gates and budgets with the rules, and exports them back", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const gated = `- required_engine_version: 3
${rule("One")}
- gate: Review first
  tool: github
  operation: issues.delete
  resource: { kind: issue, match: any }
  agent: bot
  requires: [{ agent: reviewer, verdict: ship, since: [dev] }]
  otherwise: deny
- budget: Run calls
  per: run
  tool_calls: 100
`;
    const { added, issues } = await preview(w, gated);
    expect(issues).toEqual([]);
    expect(added).toEqual(["One", "Review first", "Run calls"]);
    await publish(w, gated);
    const version = await admin.getRepository(PolicyVersion).findOneByOrFail({
      workspaceId: w.id,
      environmentId: w.environmentId,
      revision: 2,
    });
    expect(version.runPolicy).toMatchObject({
      gates: [{ name: "Review first", effect: "deny" }],
      budgets: [{ name: "Run calls", limit: 100 }],
    });

    const text = await readWorkspace(w.owner, w.id, (context) =>
      exportPolicyFile(context, ENV),
    );
    expect(text).toContain("required_engine_version: 3");
    expect(text).toContain("gate: Review first");
    expect(text).toContain("agent: bot");
    expect(text).toContain("budget: Run calls");
    // The export applies back to the same version, so nothing changes.
    const again = await preview(w, text);
    expect(again).toMatchObject({ added: [], changed: [], removed: [] });

    const fewer = await preview(
      w,
      `- required_engine_version: 3\n${rule("One")}`,
    );
    expect(fewer.removed).toEqual(["Review first", "Run calls"]);
  });

  test("refuses a gate for an agent that isn't here", async () => {
    const w = await createWorkspace();
    const { issues } = await preview(
      w,
      `- required_engine_version: 3
- gate: Review first
  tool: github
  operation: issues.delete
  resource: { kind: issue, match: any }
  agent: nobody
  requires: [{ agent: reviewer, verdict: ship }]
  otherwise: deny
`,
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      'No agent called "nobody".',
    ]);
  });

  test.each([[undefined], [5], ["x".repeat(256 * 1024 + 1)]])(
    "refuses input that is not a reasonable file",
    async (text) => {
      const w = await createWorkspace();
      expect((await preview(w, text)).issues).toHaveLength(1);
    },
  );

  test.each(["viewer"] as const)("a %s cannot", async (role) => {
    const w = await createWorkspace();
    await rejects(
      preview(w, rule("One"), await addMember(w, role)),
      "FORBIDDEN",
    );
  });
});

describe("applying a rules file", () => {
  test("publishes everything as one new version", async () => {
    const w = await createWorkspace();
    const before = await versions(w);
    expect(await publish(w, rule("One") + rule("Two", "deny"))).toMatchObject({
      added: 2,
      changed: 0,
      removed: 0,
    });
    expect(await versions(w)).toBe(before + 1);
    expect(await names(w)).toEqual(["One", "Two"]);
  });

  test("applying the same file twice changes nothing", async () => {
    const w = await createWorkspace();
    const text = rule("One");
    await publish(w, text);
    const before = await versions(w);
    expect(await publish(w, text)).toMatchObject({
      added: 0,
      changed: 0,
      removed: 0,
    });
    expect(await versions(w)).toBe(before);
  });

  test("the file wins: rules not in it are removed", async () => {
    const w = await createWorkspace();
    await publish(w, rule("One") + rule("Two"));
    expect(await publish(w, rule("One"))).toMatchObject({ removed: 1 });
    expect(await names(w)).toEqual(["One"]);
  });

  test("a change keeps the rule's identity and history", async () => {
    const w = await createWorkspace();
    await publish(w, rule("One"));
    const [first] = (await act(w, (c) => listRules(c, ENV))).rules;
    expect(await publish(w, rule("One", "deny"))).toMatchObject({ changed: 1 });
    const [second] = (await act(w, (c) => listRules(c, ENV))).rules;
    expect(second?.logicalRuleId).toBe(first?.logicalRuleId);
    expect(second?.ruleRevision).toBe(2);
    expect(second?.effect).toBe("deny");
  });

  test("a rule that comes back continues its history and can be edited", async () => {
    const w = await createWorkspace();
    await publish(w, rule("One"));
    await publish(w, rule("One", "deny"));
    await publish(w, "[]\n");
    await publish(w, rule("One"));
    const [back] = (await act(w, (c) => listRules(c, ENV))).rules;
    expect(back?.ruleRevision).toBe(3);
    expect(back?.status).toBe("active");
  });

  test("an unchanged rule keeps its revision", async () => {
    const w = await createWorkspace();
    await publish(w, rule("One"));
    await publish(w, rule("One") + rule("Two"));
    const rules = (await act(w, (c) => listRules(c, ENV))).rules;
    expect(rules.find((item) => item.name === "One")?.ruleRevision).toBe(1);
  });

  test("a stale preview is refused", async () => {
    const w = await createWorkspace();
    const expected = await previewed(w, rule("One"));
    await publish(w, rule("Other"));
    await rejects(apply(w, rule("One"), expected), "RULE_CHANGED");
  });

  test("a browser's line endings are still the same file", async () => {
    const w = await createWorkspace();
    const text = rule("One");
    const expected = await previewed(w, text.replaceAll("\n", "\r\n"));
    await expect(apply(w, text, expected)).resolves.toMatchObject({ added: 1 });
  });

  test("only the file that was previewed can be published", async () => {
    const w = await createWorkspace();
    const before = await versions(w);
    const expected = await previewed(w, rule("Shown"));
    await rejects(apply(w, rule("Not shown"), expected), "RULE_CHANGED");
    expect(await versions(w)).toBe(before);
  });

  test("a file with problems publishes nothing", async () => {
    const w = await createWorkspace();
    const before = await versions(w);
    await rejects(
      apply(w, "- rule: Bad\n", await previewed(w, "- rule: Bad\n")),
      "INVALID_INPUT",
    );
    expect(await versions(w)).toBe(before);
  });

  test("a policy manager can", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "policy_manager");
    await expect(preview(w, rule("One"), person)).resolves.toMatchObject({
      issues: [],
    });
  });

  test("a file with the removed require_approval says what to write instead", async () => {
    const w = await createWorkspace();
    const { issues } = await preview(w, rule("Review", "require_approval"));
    expect(issues).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(
          "effect: require_approval, which was removed",
        ),
      }),
    ]);
    await rejects(
      publish(w, rule("Review", "require_approval")),
      "INVALID_INPUT",
    );
  });

  test("simultaneous applies cannot both land", async () => {
    const w = await createWorkspace();
    const one = await previewed(w, rule("One"));
    const two = await previewed(w, rule("Two"));
    const results = await Promise.allSettled([
      apply(w, rule("One"), one),
      apply(w, rule("Two"), two),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("it is in the history", async () => {
    const w = await createWorkspace();
    await publish(w, rule("One"));
    const [row]: { payload_safe: { subject: string } }[] = await admin.query(
      `SELECT payload_safe FROM nodrail.audit_events
       WHERE workspace_id = $1 AND decision_code = 'rules_applied'`,
      [w.id],
    );
    expect(row?.payload_safe.subject).toBe("1 added, 0 changed, 0 removed");
  });
});

describe("exporting rules", () => {
  const exported = (w: TestWorkspace, person: Person = w.owner) =>
    readWorkspace(person, w.id, (context) => exportPolicyFile(context, ENV));

  test("what the form created applies back with no changes", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    await act(w, (context) =>
      createRule(
        context,
        ENV,
        ruleBody({
          name: "From the form",
          agentKey: "bot",
          installationName: "bot-dev",
          conditions: [{ field: "amount", op: "gt", value: 5 }],
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      ),
    );
    const text = await exported(w);
    expect(compilePolicies([{ name: "x", text }]).ok).toBe(true);
    expect(await preview(w, text)).toMatchObject({
      issues: [],
      added: [],
      changed: [],
      removed: [],
    });
  });

  test("a rule for an archived agent stays scoped to it", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    await publish(w, rule("Scoped", "allow", "  agent: bot"));
    await admin.query(
      `UPDATE nodrail.agents SET archived_at = now() WHERE workspace_id = $1`,
      [w.id],
    );
    expect(await exported(w)).toContain("agent: bot");
  });

  test("leaves out revoked rules", async () => {
    const w = await createWorkspace();
    await publish(w, rule("Kept") + rule("Gone"));
    await publish(w, rule("Kept"));
    const text = await exported(w);
    expect(text).toContain("Kept");
    expect(text).not.toContain("Gone");
  });

  test.each(["viewer"] as const)("a %s cannot", async (role) => {
    const w = await createWorkspace();
    await rejects(exported(w, await addMember(w, role)), "FORBIDDEN");
  });

  test.each(["policy_manager", "viewer"] as const)(
    "a %s can still read it as YAML",
    async (role) => {
      const w = await createWorkspace();
      await publish(w, rule("Shared"));
      const person = await addMember(w, role);
      const text = await readWorkspace(person, w.id, (context) =>
        readPolicyFile(context, ENV),
      );
      expect(text).toContain("Shared");
    },
  );
});

describe("changing one gate or budget", () => {
  const gate: GateInput = {
    name: "QA before a pull request",
    agentKey: "bot",
    toolKey: "github",
    operationKey: "pr.create",
    resource: { kind: "repository", match: "any" },
    requires: [{ agent: "qa", verdicts: ["pass"], since: ["dev"] }],
    effect: "deny",
  };
  const budget: BudgetInput = {
    name: "Calls per run",
    agent: null,
    per: "run",
    metric: "tool_calls",
    limit: 60,
    warnAt: 40,
    effect: "deny",
  };
  const live = (w: TestWorkspace) =>
    act(w, (context) => activeRunPolicy(context, ENV));
  const change = async (
    w: TestWorkspace,
    next: RunPolicyChange,
    person?: Person,
  ) => {
    const { revision } = await live(w);
    return act(
      w,
      (context) => changeRunPolicy(context, ENV, next, revision),
      person,
    );
  };

  test("adds, edits and removes them, keeping the rules as they were", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    await publish(w, rule("One"));
    const ruleIds = (await act(w, (context) => listRules(context, ENV))).rules
      .map((item) => `${item.logicalRuleId}@${item.ruleRevision}`)
      .sort();

    expect(
      await change(w, { kind: "gate", id: null, entry: gate }),
    ).toMatchObject({ ok: true, result: { added: 1, changed: 0, removed: 0 } });
    expect(
      await change(w, { kind: "budget", id: null, entry: budget }),
    ).toMatchObject({ ok: true, result: { added: 1 } });

    let policy = await live(w);
    expect(policy.gates).toMatchObject([
      { name: gate.name, agentKey: "bot", requires: gate.requires },
    ]);
    expect(policy.budgets).toMatchObject([{ name: budget.name, limit: 60 }]);
    // The rule is carried over, not rewritten.
    expect(
      (await act(w, (context) => listRules(context, ENV))).rules
        .map((item) => `${item.logicalRuleId}@${item.ruleRevision}`)
        .sort(),
    ).toEqual(ruleIds);
    const text = await act(w, (context) => readPolicyFile(context, ENV));
    expect(text).toContain(`gate: ${gate.name}`);
    expect(text).toContain(`budget: ${budget.name}`);

    const gateId = policy.gates[0]!.id;
    expect(
      await change(w, {
        kind: "gate",
        id: gateId,
        entry: { ...gate, name: "QA first", effect: "deny" },
      }),
    ).toMatchObject({ ok: true, result: { changed: 1 } });
    policy = await live(w);
    expect(policy.gates).toMatchObject([
      { id: gateId, name: "QA first", effect: "deny" },
    ]);

    await change(w, { kind: "gate", id: gateId, entry: null });
    await change(w, { kind: "budget", id: policy.budgets[0]!.id, entry: null });
    policy = await live(w);
    expect(policy.gates).toEqual([]);
    expect(policy.budgets).toEqual([]);
    expect(await names(w)).toEqual(["One"]);
  });

  test("keeps the gate's conditions the form doesn't show", async () => {
    const w = await createWorkspace();
    await publish(
      w,
      `- required_engine_version: 3
- gate: Big deletes
  tool: github
  operation: issues.delete
  resource: { kind: issue, match: any }
  condition: [{ field: count, op: gt, value: 10 }]
  requires: [{ agent: reviewer, verdict: ship }]
  otherwise: deny
`,
    );
    const [before] = (await live(w)).gates;
    await change(w, {
      kind: "gate",
      id: before!.id,
      entry: {
        ...gate,
        agentKey: null,
        name: "Big deletes, reviewed",
      },
    });
    const text = await act(w, (context) => readPolicyFile(context, ENV));
    expect(text).toContain("Big deletes, reviewed");
    expect(text).toContain("field: count");
  });

  test("names what the file would refuse, and publishes nothing", async () => {
    const w = await createWorkspace();
    const before = await versions(w);
    expect(
      await change(w, {
        kind: "gate",
        id: null,
        entry: { ...gate, agentKey: "nobody" },
      }),
    ).toEqual({ ok: false, problems: ['No agent called "nobody".'] });
    expect(await versions(w)).toBe(before);
  });

  test("refuses a page that is out of date, or an entry that is gone", async () => {
    const w = await createWorkspace();
    await rejects(
      act(w, (context) =>
        changeRunPolicy(
          context,
          ENV,
          { kind: "budget", id: null, entry: budget },
          99,
        ),
      ),
      "RULE_CHANGED",
    );
    await rejects(
      change(w, {
        kind: "budget",
        id: "00000000-0000-4000-8000-000000000000",
        entry: null,
      }),
      "NOT_FOUND",
    );
  });

  test.each(["viewer"] as const)("a %s cannot", async (role) => {
    const w = await createWorkspace();
    await rejects(
      change(
        w,
        { kind: "budget", id: null, entry: budget },
        await addMember(w, role),
      ),
      "FORBIDDEN",
    );
  });
});
