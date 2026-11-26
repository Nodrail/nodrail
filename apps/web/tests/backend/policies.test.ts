import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import type { RuleInput } from "@/contracts/v1/policies";
import {
  readWorkspace,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import { AuditEvent, PolicyRule, PolicyVersion } from "@/server/db/entities";
import {
  createRule,
  getRule,
  listRules,
  MAX_RULES_PER_ENVIRONMENT,
  revokeRule,
  updateRule,
} from "@/server/modules/policies";
import {
  applyPolicyFile,
  previewPolicyFile,
} from "@/server/modules/policies/rule-files";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  useDatabase,
  ruleBody as body,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const ENV = "development";

const asOwner = <T>(
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => withWorkspace(w.owner, w.id, run);

const create = (w: TestWorkspace, overrides: Partial<RuleInput> = {}) =>
  asOwner(w, (context) => createRule(context, ENV, body(overrides)));

const update = (
  w: TestWorkspace,
  ruleId: string,
  expected: number,
  overrides: Partial<RuleInput> = {},
) =>
  asOwner(w, (context) =>
    updateRule(context, ENV, ruleId, expected, body(overrides)),
  );

const revoke = (w: TestWorkspace, ruleId: string, expected = 1) =>
  asOwner(w, (context) => revokeRule(context, ENV, ruleId, expected));

const rulesOf = (w: TestWorkspace, person: Person = w.owner) =>
  readWorkspace(person, w.id, (context) => listRules(context, ENV));

describe("creating a rule", () => {
  test("publishes a new version and shows up as active", async () => {
    const w = await createWorkspace();
    const result = await create(w, { name: "Delete issues" });
    expect(result.policyRevision).toBe(2);
    const { rules, policyRevision } = await rulesOf(w);
    expect(policyRevision).toBe(2);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      name: "Delete issues",
      status: "active",
      ruleRevision: 1,
      updatedBy: "Owner",
    });
  });

  test("at the rule limit, tells the caller to revoke one and succeeds after revocation", async () => {
    const w = await createWorkspace();
    const yaml = Array.from(
      { length: MAX_RULES_PER_ENVIRONMENT },
      (_, index) => `
- rule: Read issues ${index}
  tool: github
  operation: issues.read
  resource: { kind: issue, match: exact, value: issue-${index} }
  effect: allow
`,
    ).join("");
    const published = await asOwner(w, async (context) => {
      const preview = await previewPolicyFile(context, ENV, yaml);
      return applyPolicyFile(context, ENV, yaml, {
        revision: preview.policyRevision,
        fileDigest: preview.fileDigest,
      });
    });
    expect(published.added).toBe(MAX_RULES_PER_ENVIRONMENT);
    await expect(create(w, { name: "One too many" })).rejects.toMatchObject({
      code: "RULE_LIMIT_REACHED",
      detail: expect.stringContaining(
        "Revoke an existing rule before creating another.",
      ),
    });
    const before = await rulesOf(w);
    expect(before.policyRevision).toBe(published.policyRevision);
    await revoke(w, before.rules[0]!.logicalRuleId);
    await expect(create(w, { name: "One too many" })).resolves.toMatchObject({
      policyRevision: published.policyRevision + 2,
    });
  });

  test("records who published it", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w);
    const [event] = await admin.getRepository(AuditEvent).findBy({
      workspaceId: w.id,
      eventType: "policy.published",
    });
    expect(event).toMatchObject({
      actorUserId: w.owner.userId,
      decisionCode: "rule_create",
      matchedLogicalRuleId: logicalRuleId,
    });
  });

  test("can target one agent and its installation", async () => {
    const w = await createWorkspace();
    await createAgent(w, "one");
    await create(w, { agentKey: "one", installationName: "one-dev" });
    const { rules } = await rulesOf(w);
    expect(rules[0]).toMatchObject({
      agentKey: "one",
      installationName: "one-dev",
    });
  });

  test.each<[string, Partial<RuleInput>]>([
    ["an unknown agent", { agentKey: "nobody" }],
    ["an installation without an agent", { installationName: "x-dev" }],
    [
      "another agent's installation",
      { agentKey: "one", installationName: "two-dev" },
    ],
    ["an empty name", { name: "  " }],
    [
      "a resource value with match any",
      { resource: { kind: "issue", match: "any", value: "x" } },
    ],
    [
      "no value for an exact match",
      { resource: { kind: "issue", match: "exact" } },
    ],
    [
      "a list for eq",
      { conditions: [{ field: "a", op: "eq", value: [1] as never }] },
    ],
    ["a scalar for in", { conditions: [{ field: "a", op: "in", value: 1 }] }],
    [
      "an unsafe field path",
      { conditions: [{ field: "a;b", op: "eq", value: 1 }] },
    ],
  ])("rejects %s", async (_label, overrides) => {
    const w = await createWorkspace();
    await createAgent(w, "one");
    await createAgent(w, "two");
    await expect(create(w, overrides)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      admin.getRepository(PolicyVersion).countBy({ workspaceId: w.id }),
    ).resolves.toBe(2);
  });

  test("another workspace's agent does not exist", async () => {
    const w = await createWorkspace();
    const other = await createWorkspace();
    await createAgent(other, "theirs");
    await expect(create(w, { agentKey: "theirs" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("who can change rules", () => {
  let w: TestWorkspace;
  let ruleId: string;

  beforeAll(async () => {
    w = await createWorkspace();
    ({ logicalRuleId: ruleId } = await create(w));
  });

  test.each(["viewer"] as const)(
    "%s cannot create, edit or revoke",
    async (role) => {
      const person = await addMember(w, role);
      for (const action of [
        (context: WorkspaceContext) => createRule(context, ENV, body()),
        (context: WorkspaceContext) =>
          updateRule(context, ENV, ruleId, 1, body()),
        (context: WorkspaceContext) => revokeRule(context, ENV, ruleId, 1),
      ])
        await expect(withWorkspace(person, w.id, action)).rejects.toMatchObject(
          { code: "FORBIDDEN", status: 403 },
        );
    },
  );

  test.each(["admin", "policy_manager"] as const)("%s can", async (role) => {
    const person = await addMember(w, role);
    await expect(
      withWorkspace(person, w.id, (context) =>
        createRule(context, ENV, body({ name: `By ${role}` })),
      ),
    ).resolves.toBeTruthy();
  });
});

describe("editing and revoking", () => {
  test("editing keeps the identity and adds a revision", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w, { name: "Before" });
    await update(w, logicalRuleId, 1, { name: "After", effect: "deny" });
    const { rules } = await rulesOf(w);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      logicalRuleId,
      name: "After",
      effect: "deny",
      ruleRevision: 2,
    });
  });

  test("a stale edit is refused, not overwritten", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w);
    await update(w, logicalRuleId, 1, { name: "First" });
    await expect(
      update(w, logicalRuleId, 1, { name: "Second" }),
    ).rejects.toMatchObject({ code: "RULE_CHANGED", status: 409 });
    await expect(revoke(w, logicalRuleId, 1)).rejects.toMatchObject({
      code: "RULE_CHANGED",
    });
  });

  test("editing one rule does not conflict with another", async () => {
    const w = await createWorkspace();
    const one = await create(w, { name: "One" });
    const two = await create(w, { name: "Two" });
    await update(w, one.logicalRuleId, 1, { name: "One edited" });
    await update(w, two.logicalRuleId, 1, { name: "Two edited" });
    const { rules } = await rulesOf(w);
    expect(rules.map((rule) => rule.name).sort()).toEqual([
      "One edited",
      "Two edited",
    ]);
  });

  test("revoking keeps it as read-only history", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w, { name: "Gone" });
    await revoke(w, logicalRuleId);
    const { rules } = await rulesOf(w);
    expect(rules[0]).toMatchObject({ name: "Gone", status: "revoked" });
    await expect(
      update(w, logicalRuleId, 1, { name: "Back" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("past versions are never altered", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w, { name: "Original" });
    const [before] = await admin
      .getRepository(PolicyRule)
      .findBy({ workspaceId: w.id });
    await update(w, logicalRuleId, 1, { name: "Changed" });
    await expect(
      admin.getRepository(PolicyRule).findOneByOrFail({ id: before?.id }),
    ).resolves.toMatchObject({ name: "Original" });
  });

  test("the history shows each revision and who revoked it", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w, {
      name: "Tracked",
      conditions: [{ field: "issue", op: "gt", value: 1 }],
    });
    await update(w, logicalRuleId, 1, { name: "Tracked", effect: "deny" });
    await create(w, { name: "Unrelated" });
    await revoke(w, logicalRuleId, 2);
    const detail = await readWorkspace(w.owner, w.id, (context) =>
      getRule(context, ENV, logicalRuleId),
    );
    expect(detail.status).toBe("revoked");
    expect(detail.revoked?.by).toBe("Owner");
    expect(detail.history.map((item) => item.revision)).toEqual([2, 1]);
    expect(detail.history[1]?.summary).toContain("issue > 1");
    expect(detail.history[0]?.summary).toContain("Deny");
  });

  test("an unknown or malformed rule is not found", async () => {
    const w = await createWorkspace();
    for (const id of [randomUUID(), "nope"])
      await expect(
        readWorkspace(w.owner, w.id, (context) => getRule(context, ENV, id)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("an expired rule says so", async () => {
    const w = await createWorkspace();
    await create(w, { expiresAt: "2020-01-01T00:00:00Z" });
    const { rules } = await rulesOf(w);
    expect(rules[0]?.status).toBe("expired");
  });
});

describe("under concurrency", () => {
  test("simultaneous publishes all land, in order", async () => {
    const w = await createWorkspace();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        create(w, { name: `Rule ${index}` }),
      ),
    );
    expect(
      results.map((item) => item.policyRevision).sort((a, b) => a - b),
    ).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    const { rules } = await rulesOf(w);
    expect(rules).toHaveLength(8);
  });

  test("two edits of one rule: exactly one wins", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await create(w);
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map((index) =>
        update(w, logicalRuleId, 1, { name: `Edit ${index}` }),
      ),
    );
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
  });
});

describe("what each person can see", () => {
  test("workspace-wide rules and their own agents' rules only", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await createAgent(w, "mine", [viewer]);
    await createAgent(w, "theirs");
    await create(w, { name: "Global" });
    await create(w, { name: "Mine", agentKey: "mine" });
    const hidden = await create(w, { name: "Theirs", agentKey: "theirs" });
    // createAgent seeds one rule per agent in the first version.
    const { rules } = await rulesOf(w, viewer);
    const names = rules.map((rule) => rule.name);
    expect(names).toContain("Global");
    expect(names).toContain("Mine");
    expect(names).not.toContain("Theirs");
    expect(names).not.toContain("theirs rule");
    await expect(
      readWorkspace(viewer, w.id, (context) =>
        getRule(context, ENV, hidden.logicalRuleId),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
