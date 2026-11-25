import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { RuleInput } from "@/contracts/v1/policies";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { AuditEvent, ClientReport, Environment } from "@/server/db/entities";
import { getActivityEvent, listActivity } from "@/server/modules/activity";
import { pauseAgent, rotateCredential } from "@/server/modules/agents";
import { createRule, updateRule } from "@/server/modules/policies";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  ruleBody,
  seedAction,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
} from "./world";
import { codes, decided, ENV, list } from "./activity-world";

useDatabase();

const detail = (
  person: HumanPrincipal,
  w: TestWorkspace,
  id: string,
  environment = ENV,
) =>
  readWorkspace(person, w.id, (context) =>
    getActivityEvent(context, environment, id),
  );

const report = (
  w: TestWorkspace,
  agent: TestAgent,
  outcome: "success" | "failure" | "unknown",
  options: { details?: object; receivedAt?: Date } = {},
) =>
  admin.getRepository(ClientReport).insert({
    workspaceId: w.id,
    installationId: agent.installationId,
    actionRequestId: agent.actionId,
    clientReportKey: randomUUID(),
    outcome,
    detailsSafe: options.details ?? {},
    receivedAt: options.receivedAt ?? new Date(),
  });

const denyDeletes = (overrides: Partial<RuleInput>) =>
  ruleBody({ effect: "deny", ...overrides });

const publish = (w: TestWorkspace, overrides: Partial<RuleInput> = {}) =>
  withWorkspace(w.owner, w.id, (context) =>
    createRule(context, ENV, denyDeletes(overrides)),
  );

async function withAgent(key = "support") {
  const w = await createWorkspace();
  const agent = await createAgent(w, key);
  return { w, agent };
}

describe("the history", () => {
  test("records who decided what, newest first", async () => {
    const { w, agent } = await withAgent();
    await decided(w, agent, "denied_by_rule");
    const { items } = await list(w.owner, w);
    expect(items.map((item) => item.code)).toEqual([
      "denied_by_rule",
      "allowed_by_rule",
    ]);
    expect(items[0]).toMatchObject({
      group: "decision",
      outcome: "denied",
      label: "Denied by rule",
      actor: { kind: "runtime" },
      agentKey: "support",
      environment: "Development",
      action: {
        toolKey: "github",
        operationKey: "issues.delete",
        resource: "acme/support#482",
        installationName: "support-dev",
      },
      latestReport: null,
    });
  });

  test("workspace changes are listed apart from decisions", async () => {
    const { w } = await withAgent();
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "support"),
    );
    expect(await codes(w.owner, w, { kind: "changes" })).toEqual([
      "agent_paused",
    ]);
    const decisions = await codes(w.owner, w, { kind: "decisions" });
    expect(decisions).not.toContain("agent_paused");
    expect(decisions).toContain("allowed_by_rule");
  });

  test("an agent-wide change reaches every environment", async () => {
    const { w } = await withAgent();
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "support"),
    );
    const inProduction = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, "production", {}),
    );
    expect(inProduction.items.map((item) => item.code)).toEqual([
      "agent_paused",
    ]);
    expect(inProduction.items[0]?.environment).toBeNull();
  });

  test("events of another environment stay there", async () => {
    const { w } = await withAgent();
    const production = await admin
      .getRepository(Environment)
      .findOneByOrFail({ workspaceId: w.id, slug: "production" });
    const { id } = (
      await admin.getRepository(AuditEvent).insert({
        workspaceId: w.id,
        eventType: "authorization.decided",
        actorKind: "system",
        decisionCode: "denied_by_rule",
        environmentId: production.id,
      })
    ).identifiers[0] as { id: string };
    expect(await codes(w.owner, w)).not.toContain("denied_by_rule");
    await expect(detail(w.owner, w, id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(detail(w.owner, w, id, "production")).resolves.toMatchObject({
      environment: "Production",
    });
  });

  test("a credential change belongs to its environment", async () => {
    const { w, agent } = await withAgent();
    await withWorkspace(w.owner, w.id, (context) =>
      rotateCredential(context, agent.installationId),
    );
    expect(await codes(w.owner, w, { kind: "changes" })).toEqual([
      "credential_rotated",
    ]);
    const inProduction = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, "production", {}),
    );
    expect(inProduction.items).toEqual([]);
  });

  test("a rule keeps the name it had at each event", async () => {
    const w = await createWorkspace();
    const { logicalRuleId } = await publish(w, { name: "First name" });
    await withWorkspace(w.owner, w.id, (context) =>
      updateRule(
        context,
        ENV,
        logicalRuleId,
        1,
        denyDeletes({ name: "Second name" }),
      ),
    );
    const { items } = await list(w.owner, w, { kind: "changes", q: "name" });
    expect(items.map((item) => [item.code, item.rule?.name])).toEqual([
      ["rule_update", "Second name"],
      ["rule_create", "First name"],
    ]);
    expect(items[0]?.rule).toMatchObject({ id: logicalRuleId, revision: 3 });
  });

  test("anything unrecognised in the URL means no filter", async () => {
    const { w } = await withAgent();
    expect(
      await codes(w.owner, w, { kind: "bogus", outcome: "bogus", q: 5 }),
    ).toEqual(await codes(w.owner, w));
  });
});

describe("search", () => {
  async function twoAgents() {
    const w = await createWorkspace();
    const one = await createAgent(w, "support");
    const two = await createAgent(w, "billing");
    await admin.transaction((manager) =>
      seedAction(manager, w, two, {
        toolKey: "stripe",
        operationKey: "refunds.create",
        resourceKind: "invoice",
        resourceId: "INV_100%",
      }),
    );
    await admin.query(
      `INSERT INTO nodrail.audit_events
         (workspace_id, event_type, actor_kind, decision_code, agent_id,
          action_request_id, environment_id)
       SELECT workspace_id, 'authorization.decided', 'system', 'denied_by_rule',
              agent_id, id, environment_id
       FROM nodrail.action_requests
       WHERE workspace_id = $1 AND tool_key = 'stripe'`,
      [w.id],
    );
    return { w, one, two };
  }

  const keys = async (w: TestWorkspace, q: string) =>
    codes(w.owner, w, { q, kind: "decisions" });

  test.each([
    ["agent", "billing", ["denied_by_rule", "allowed_by_rule"]],
    ["operation", "refunds.create", ["denied_by_rule"]],
    ["resource", "inv_100", ["denied_by_rule"]],
    ["nothing", "absent", []],
  ])("by %s", async (_label, q, expected) => {
    const { w } = await twoAgents();
    expect(await keys(w, q)).toEqual(expected);
  });

  test("finds a request by its reference, with or without prefix", async () => {
    const { w, one } = await twoAgents();
    const short = one.actionId.slice(0, 8);
    expect(await keys(w, `REQ-${short.toUpperCase()}`)).toEqual([
      "allowed_by_rule",
    ]);
    expect(await keys(w, short)).toEqual(["allowed_by_rule"]);
  });

  test("wildcards are ordinary characters", async () => {
    const { w } = await twoAgents();
    expect(await keys(w, "%")).toEqual(["denied_by_rule"]);
    expect(await keys(w, "INV_")).toEqual(["denied_by_rule"]);
    expect(await keys(w, "_")).toEqual(["denied_by_rule"]);
    expect(await keys(w, "\\")).toEqual([]);
  });
});

describe("client reports stay separate from decisions", () => {
  test("a report never changes the recorded decision", async () => {
    const { w, agent } = await withAgent();
    await decided(w, agent, "denied_by_rule");
    await report(w, agent, "success");
    const [newest] = (await list(w.owner, w)).items;
    expect(newest).toMatchObject({
      outcome: "denied",
      latestReport: { outcome: "success" },
    });
  });

  test("the filter returns only events with a report", async () => {
    const w = await createWorkspace();
    const reported = await createAgent(w, "reported");
    await createAgent(w, "silent");
    await report(w, reported, "failure");
    const { items } = await list(w.owner, w, { kind: "reports" });
    expect(items.map((item) => [item.agentKey, item.code])).toEqual([
      ["reported", "allowed_by_rule"],
    ]);
  });

  test("a report of an action Nodrail never allowed is flagged until a rule allows it", async () => {
    const { w, agent } = await withAgent();
    // The world's own action carries an allow; this one was denied.
    const stray = await admin.transaction((manager) =>
      seedAction(manager, w, agent),
    );
    const strayAgent = { ...agent, ...stray };
    await decided(w, strayAgent, "denied_by_rule");
    await report(w, agent, "success");
    await report(w, strayAgent, "success");

    const flagged = await list(w.owner, w, { kind: "mismatches" });
    expect(flagged.items.map((item) => item.code)).toEqual(["denied_by_rule"]);
    expect(flagged.items[0]?.latestReport).toMatchObject({
      outcome: "success",
      mismatch: true,
    });
    const allowed = (await list(w.owner, w)).items.find(
      (item) => item.code === "allowed_by_rule",
    );
    expect(allowed?.latestReport?.mismatch).toBe(false);
    const found = await detail(w.owner, w, flagged.items[0]?.id ?? "");
    expect(found.latestReport?.mismatch).toBe(true);

    await decided(w, strayAgent, "allowed_by_rule");
    expect((await list(w.owner, w, { kind: "mismatches" })).items).toEqual([]);
  });

  test("a report that claims nothing ran is never a mismatch", async () => {
    const { w, agent } = await withAgent();
    const stray = await admin.transaction((manager) =>
      seedAction(manager, w, agent),
    );
    await report(w, { ...agent, ...stray }, "unknown");
    expect((await list(w.owner, w, { kind: "mismatches" })).items).toEqual([]);
  });

  test("detail lists every report, newest first, as sent", async () => {
    const { w, agent } = await withAgent();
    const [event] = (await list(w.owner, w)).items;
    await report(w, agent, "failure", {
      details: { note: "<img src=x onerror=alert(1)>" },
      receivedAt: new Date(Date.now() - 60_000),
    });
    await report(w, agent, "success");
    const found = await detail(w.owner, w, event?.id ?? "");
    expect(found.reports.map((item) => item.outcome)).toEqual([
      "success",
      "failure",
    ]);
    expect(found.latestReport?.outcome).toBe("success");
    expect(found.reports[1]).toMatchObject({
      linkedToPermit: false,
      details: { note: "<img src=x onerror=alert(1)>" },
    });
    expect(found.parameters).toEqual({ issue: 482 });
  });

  test("changes carry no report or parameters", async () => {
    const { w } = await withAgent();
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "support"),
    );
    const [event] = (await list(w.owner, w, { kind: "changes" })).items;
    await expect(detail(w.owner, w, event?.id ?? "")).resolves.toMatchObject({
      action: null,
      parameters: null,
      reports: [],
    });
  });
});

describe("who sees what", () => {
  test("another workspace's event does not exist", async () => {
    const { w } = await withAgent();
    const other = await createWorkspace();
    const [event] = (await list(w.owner, w)).items;
    await expect(
      detail(other.owner, other, event?.id ?? ""),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await list(other.owner, other)).items).toEqual([]);
  });

  test.each(["not-a-uuid", randomUUID()])("unknown id %s", async (id) => {
    const { w } = await withAgent();
    await expect(detail(w.owner, w, id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("whole-workspace roles see every agent", async () => {
    const w = await createWorkspace();
    await createAgent(w, "one");
    await createAgent(w, "two");
    for (const role of ["admin", "policy_manager"] as const) {
      const person = await addMember(w, role);
      const { items } = await list(person, w, { kind: "decisions" });
      expect(new Set(items.map((item) => item.agentKey))).toEqual(
        new Set(["one", "two"]),
      );
    }
  });

  test("a viewer sees only assigned agents", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "viewer");
    await createAgent(w, "mine", [person]);
    await createAgent(w, "theirs");
    const { items } = await list(person, w);
    expect(new Set(items.map((item) => item.agentKey))).toEqual(
      new Set(["mine"]),
    );
    const theirs = (await list(w.owner, w)).items.find(
      (item) => item.agentKey === "theirs",
    );
    await expect(detail(person, w, theirs?.id ?? "")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("reports on a hidden agent stay hidden", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    const hidden = await createAgent(w, "hidden");
    await report(w, hidden, "success");
    expect((await list(viewer, w, { kind: "reports" })).items).toEqual([]);
  });

  test("a rule on an assigned agent is visible to its people only", async () => {
    const w = await createWorkspace();
    const assigned = await addMember(w, "viewer");
    const other = await addMember(w, "viewer");
    await createAgent(w, "mine", [assigned]);
    await createAgent(w, "theirs", [other]);
    await publish(w, { agentKey: "mine", name: "Scoped" });
    await publish(w, { name: "Everywhere" });
    const changes = (person: HumanPrincipal) =>
      codes(person, w, { kind: "changes" });
    expect(await changes(assigned)).toEqual(["rule_create"]);
    expect(await changes(other)).toEqual([]);
    expect(await changes(w.owner)).toEqual(["rule_create", "rule_create"]);
  });
});

describe("paging", () => {
  test("walks the whole history once, even with identical times", async () => {
    const w = await createWorkspace();
    const occurredAt = new Date();
    const inserted = Array.from({ length: 7 }, () => randomUUID());
    await admin.getRepository(AuditEvent).insert(
      inserted.map((id) => ({
        id,
        workspaceId: w.id,
        eventType: "authorization.decided",
        actorKind: "system" as const,
        decisionCode: "allowed_by_rule",
        environmentId: w.environmentId,
        occurredAt,
      })),
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list(w.owner, w, { cursor }, 3);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(seen)).toEqual(new Set(inserted));
    expect(seen).toHaveLength(7);
  });

  test("a damaged cursor is refused", async () => {
    const { w } = await withAgent();
    await expect(
      list(w.owner, w, { cursor: "bm90LWEtY3Vyc29y" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
