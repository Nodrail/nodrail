import { randomBytes, randomUUID } from "node:crypto";
import {
  actionDigest,
  descriptorDigest,
  nonceDigest,
  type ActionStatus,
  type PermitAllow,
} from "@nodrail/client/protocol";
import { describe, expect, test } from "vitest";
import type { RuleInput } from "@/contracts/v1/policies";
import {
  readWorkspace,
  withRuntime,
  withWorkspace,
  type RuntimeContext,
  type RuntimeScope,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  AuditEvent,
  ClientReport,
  DecisionPermit,
  InstallationCredential,
  Installation,
  ObservedPermission,
} from "@/server/db/entities";
import { listActivity } from "@/server/modules/activity";
import { getOverviewState } from "@/server/modules/overview";
import {
  pauseAgent,
  resumeAgent,
  revokeCredential,
} from "@/server/modules/agents";
import { createRule, revokeRule } from "@/server/modules/policies";
import {
  findActionByKey,
  getActionStatus,
  recordHeartbeat,
  reportOutcome,
  requestPermit,
  submitAction,
} from "@/server/modules/runtime";
import { list } from "./activity-world";
import {
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  losesRaceTo,
  ruleBody,
  useDatabase,
  type Person,
  type TestAgent,
  type TestWorkspace,
} from "./world";

useDatabase();

const ENV = "development";

type Rig = { w: TestWorkspace; agent: TestAgent; token: string };

const owner = <T>(
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => withWorkspace(w.owner, w.id, run);

async function rig(key = "bot", assignees: Person[] = []): Promise<Rig> {
  const w = await createWorkspace();
  const agent = await createAgent(w, key, assignees);
  return { w, agent, token: await issueToken(w, agent) };
}

const descriptor = (overrides: object = {}) => ({
  tool: "github",
  operation: "issues.create",
  resource: { kind: "repository", id: "acme/app" },
  params: { title: "Hello", labels: ["a"] },
  ...overrides,
});

const call = <T>(
  token: string,
  scope: RuntimeScope,
  run: (context: RuntimeContext) => Promise<T>,
) => withRuntime(token, scope, run);

const submit = (
  token: string,
  body: object = descriptor(),
  key: unknown = randomUUID(),
) =>
  call(token, "actions:submit", (context) => submitAction(context, key, body));

const nonce = () => randomBytes(16).toString("hex");

const permit = (token: string, action: ActionStatus, n = nonce()) =>
  call(token, "permits:request", (context) =>
    requestPermit(context, action.action_id, {
      action_digest: action.action_digest,
      nonce: n,
    }),
  );

const status = (token: string, id: string) =>
  call(token, "actions:read-own", (context) => getActionStatus(context, id));

const rule = (w: TestWorkspace, overrides: Partial<RuleInput> = {}) =>
  owner(w, (context) =>
    createRule(
      context,
      ENV,
      ruleBody({
        name: "Rule",
        toolKey: "github",
        operationKey: "issues.create",
        resource: { kind: "repository", match: "any" },
        ...overrides,
      }),
    ),
  );

const allowRule = (w: TestWorkspace) => rule(w, { effect: "allow" });

const permits = (w: TestWorkspace) =>
  admin.getRepository(DecisionPermit).countBy({ workspaceId: w.id });

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

const expectAllow = (result: unknown): PermitAllow => {
  expect(result).toMatchObject({ code: "ALLOW" });
  return result as PermitAllow;
};

describe("authentication", () => {
  test.each([
    ["garbage", "not-a-token"],
    ["unknown prefix", `ndr_000000000000_${"a".repeat(43)}`],
  ])("%s", async (_label, token) => {
    await rejects(submit(token), "UNAUTHENTICATED");
  });

  test("a right prefix with the wrong secret", async () => {
    const { token } = await rig();
    await rejects(submit(`${token.slice(0, -4)}aaaa`), "UNAUTHENTICATED");
  });

  test("a rotated credential stops at once", async () => {
    const { w, agent, token } = await rig();
    await issueToken(w, agent);
    await rejects(submit(token), "UNAUTHENTICATED");
  });

  test("a revoked credential stops at once", async () => {
    const { w, agent, token } = await rig();
    await owner(w, (context) =>
      revokeCredential(context, agent.installationId),
    );
    await rejects(submit(token), "UNAUTHENTICATED");
  });

  test("an expired credential is refused", async () => {
    const { w, agent, token } = await rig();
    await admin
      .getRepository(InstallationCredential)
      .update(
        { workspaceId: w.id, installationId: agent.installationId },
        { expiresAt: new Date(Date.now() - 1000) },
      );
    await rejects(submit(token), "UNAUTHENTICATED");
  });

  test("an archived installation is refused", async () => {
    const { w, agent, token } = await rig();
    await admin.getRepository(Installation).update(
      { id: agent.installationId, workspaceId: w.id },
      {
        archivedAt: new Date(),
      },
    );
    await rejects(submit(token), "UNAUTHENTICATED");
  });

  test("a credential needs the scope for each call", async () => {
    const { w, agent, token } = await rig();
    await admin.query(
      `UPDATE nodrail.installation_credentials SET scopes = '{heartbeat:write}'
       WHERE workspace_id = $1 AND installation_id = $2 AND revoked_at IS NULL`,
      [w.id, agent.installationId],
    );
    await rejects(submit(token), "FORBIDDEN");
    await expect(
      call(token, "heartbeat:write", (context) => recordHeartbeat(context, {})),
    ).resolves.toEqual({ recorded: true });
  });

  test("the lookup is reachable only by the application role", async () => {
    const [row]: { app: boolean; reader: boolean }[] = await admin.query(
      `SELECT
         has_function_privilege('nodrail_app',
           'nodrail.workspace_for_credential(text)', 'execute') AS app,
         has_function_privilege('nodrail_member_read',
           'nodrail.workspace_for_credential(text)', 'execute') AS reader`,
    );
    expect(row).toEqual({ app: true, reader: false });
  });
});

describe("submitting an action", () => {
  test("with no rule it is denied at once, and says so", async () => {
    const { w, token } = await rig();
    const action = await submit(token);
    expect(action).toMatchObject({ code: "DENIED", reason: "no_rule" });
    expect(action.reference).toMatch(/^REQ-/);
    const { items } = await list(w.owner, w, { outcome: "denied" });
    expect(items[0]).toMatchObject({
      code: "denied_no_rule",
      label: "Denied · no rule covers it",
      action: { operationKey: "issues.create", resource: "acme/app" },
      rule: null,
    });
    // Nothing waits for a person: there is never a permit to ask for.
    await expect(permit(token, action)).resolves.toMatchObject({
      code: "DENIED",
    });
  });

  test("an allow rule makes it ready, without asking anyone", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    const action = await submit(token);
    expect(action.code).toBe("READY");
    expect(action.reference).toMatch(/^REQ-/);
  });

  test("a deny rule beats everything and is recorded", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    await rule(w, { effect: "deny", name: "Stop" });
    const action = await submit(token);
    expect(action).toMatchObject({ code: "DENIED", reason: "rule" });
    const { items } = await list(w.owner, w, { outcome: "denied" });
    expect(items[0]).toMatchObject({
      code: "denied_by_rule",
      actor: { kind: "system" },
      action: { operationKey: "issues.create" },
      rule: { name: "Stop" },
    });
  });

  test("a paused agent is denied, even with an allow rule", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    await owner(w, (context) => pauseAgent(context, "bot"));
    await expect(submit(token)).resolves.toMatchObject({ code: "DENIED" });
    expect(
      await admin.getRepository(AuditEvent).countBy({
        workspaceId: w.id,
        decisionCode: "denied_agent_paused",
      }),
    ).toBe(1);
  });

  test("the digests are the ones the client computes", async () => {
    const { agent, token } = await rig();
    const body = descriptor();
    const action = await submit(token, body);
    const digest = descriptorDigest(agent.installationId, body);
    expect(action.descriptor_digest).toBe(digest);
    expect(action.action_digest).toBe(actionDigest(action.action_id, digest));
  });

  test("it is listed as an observed permission", async () => {
    const { w, agent, token } = await rig();
    await submit(token);
    await submit(token);
    const row = await admin.getRepository(ObservedPermission).findOneByOrFail({
      installationId: agent.installationId,
      toolKey: "github",
      operationKey: "issues.create",
      workspaceId: w.id,
    });
    expect(row).toMatchObject({
      attemptCount: 2,
      lastOutcome: "unknown_blocked",
    });
  });

  test.each([
    ["bad tool", descriptor({ tool: "Bad Tool" })],
    ["bad operation", descriptor({ operation: "UP" })],
    ["no resource", { ...descriptor(), resource: undefined }],
    [
      "long resource",
      descriptor({ resource: { kind: "k", id: "x".repeat(513) } }),
    ],
    ["params not an object", descriptor({ params: [1] })],
    ["huge params", descriptor({ params: { a: "x".repeat(33_000) } })],
    ["extra field", { ...descriptor(), workspace_id: randomUUID() }],
  ])("refuses %s", async (_label, body) => {
    const { token } = await rig();
    await rejects(submit(token, body), "INVALID_INPUT");
  });

  test.each([[""], ["x".repeat(129)], [null]])(
    "refuses idempotency key %j",
    async (key) => {
      const { token } = await rig();
      await rejects(submit(token, descriptor(), key), "INVALID_INPUT");
    },
  );
});

describe("idempotency", () => {
  test("a repeat is the same action, counted as an attempt", async () => {
    const { w, token } = await rig();
    const key = randomUUID();
    const first = await submit(token, descriptor(), key);
    const again = await submit(token, descriptor(), key);
    expect(again.action_id).toBe(first.action_id);
    const [row]: { attempt_count: number }[] = await admin.query(
      `SELECT attempt_count FROM nodrail.action_requests
       WHERE workspace_id = $1 AND id = $2`,
      [w.id, first.action_id],
    );
    expect(row?.attempt_count).toBe(2);
  });

  test("the same key with different content is refused", async () => {
    const { token } = await rig();
    const key = randomUUID();
    await submit(token, descriptor(), key);
    await rejects(
      submit(token, descriptor({ params: { title: "Other" } }), key),
      "IDEMPOTENCY_CONFLICT",
    );
  });

  test("key order inside params does not change identity", async () => {
    const { token } = await rig();
    const key = randomUUID();
    const a = await submit(token, descriptor({ params: { a: 1, b: 2 } }), key);
    const b = await submit(token, descriptor({ params: { b: 2, a: 1 } }), key);
    expect(b.action_id).toBe(a.action_id);
  });

  test("simultaneous repeats create one action", async () => {
    const { w, token } = await rig();
    const key = randomUUID();
    const all = await Promise.all(
      Array.from({ length: 6 }, () => submit(token, descriptor(), key)),
    );
    expect(new Set(all.map((item) => item.action_id)).size).toBe(1);
    const [row]: { n: number }[] = await admin.query(
      `SELECT count(*)::int AS n FROM nodrail.action_requests
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [w.id, key],
    );
    expect(row?.n).toBe(1);
  });

  test("two separate calls that look alike are decided separately", async () => {
    const { w, token } = await rig();
    const one = await submit(token);
    const two = await submit(token);
    expect(two.action_id).not.toBe(one.action_id);
    expect(two.action_digest).not.toBe(one.action_digest);
    await allowRule(w);
    expectAllow(await permit(token, await submit(token)));
    expect((await status(token, two.action_id)).code).toBe("DENIED");
  });

  test("keys belong to one installation", async () => {
    const { token } = await rig();
    const other = await rig();
    const key = randomUUID();
    const mine = await submit(token, descriptor(), key);
    const theirs = await submit(other.token, descriptor(), key);
    expect(theirs.action_id).not.toBe(mine.action_id);
  });
});

describe("the permit", () => {
  async function ready() {
    const setup = await rig();
    await allowRule(setup.w);
    return { ...setup, action: await submit(setup.token) };
  }

  test("is issued for a ready action, exactly as asked", async () => {
    const { w, agent, token, action } = await ready();
    const n = nonce();
    const result = expectAllow(await permit(token, action, n));
    expect(result).toMatchObject({
      action_id: action.action_id,
      action_digest: action.action_digest,
      installation_id: agent.installationId,
      claim_nonce: n,
    });
    expect(Date.parse(result.expires_at) - Date.parse(result.issued_at)).toBe(
      5000,
    );
    const stored = await admin
      .getRepository(DecisionPermit)
      .findOneByOrFail({ id: result.permit_id, workspaceId: w.id });
    expect(stored.claimNonceDigest).toBe(nonceDigest(n));
    expect(JSON.stringify(stored)).not.toContain(n);
  });

  test("is issued once and never shown again", async () => {
    const { w, token, action } = await ready();
    expectAllow(await permit(token, action));
    await rejects(permit(token, action), "PERMIT_ALREADY_ISSUED");
    expect(await permits(w)).toBe(1);
    expect((await status(token, action.action_id)).code).toBe("PERMIT_ISSUED");
  });

  test("two at once give exactly one", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { w, token, action } = await ready();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => permit(token, action)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected")
          expect(result.reason).toMatchObject({
            code: "PERMIT_ALREADY_ISSUED",
          });
      expect(await permits(w)).toBe(1);
    }
  });

  test("the wrong digest gets nothing", async () => {
    const { w, token, action } = await ready();
    await rejects(
      permit(token, { ...action, action_digest: "sha256:other" }),
      "ACTION_CHANGED",
    );
    expect(await permits(w)).toBe(0);
  });

  test("a pause blocks it, and resuming does not bring it back", async () => {
    const { w, token, action } = await ready();
    await owner(w, (context) => pauseAgent(context, "bot"));
    await expect(permit(token, action)).resolves.toMatchObject({
      code: "DENIED",
      reason: "agent_paused",
    });
    await owner(w, (context) => resumeAgent(context, "bot"));
    await expect(permit(token, action)).resolves.toMatchObject({
      code: "INVALIDATED",
    });
    expect(await permits(w)).toBe(0);
  });

  test("a new deny rule blocks a ready action", async () => {
    const { w, token, action } = await ready();
    await rule(w, { effect: "deny", name: "Stop" });
    await expect(permit(token, action)).resolves.toMatchObject({
      code: "DENIED",
    });
  });

  test("a removed allow rule leaves it without authority", async () => {
    const { w, token, action } = await ready();
    const { rules } = await readWorkspace(w.owner, w.id, async (context) => {
      const [row]: { logical_rule_id: string }[] = await context.manager.query(
        `SELECT r.logical_rule_id FROM nodrail.policy_rules r
         JOIN nodrail.active_policies a
           ON a.policy_version_id = r.policy_version_id
         WHERE r.workspace_id = $1 AND r.name = 'Rule'`,
        [w.id],
      );
      return { rules: row?.logical_rule_id ?? "" };
    });
    await owner(w, (context) => revokeRule(context, ENV, rules, 1));
    await expect(permit(token, action)).resolves.toMatchObject({
      code: "INVALIDATED",
      reason: "policy_changed",
    });
  });

  test("a pause that commits first always wins", async () => {
    const { w, agent, token, action } = await ready();
    const pending = losesRaceTo(
      async (query) => {
        await query(
          `UPDATE nodrail.agents
       SET access_status = 'paused', access_epoch = access_epoch + 1,
           paused_at = now(), paused_by = $2
       WHERE id = $1`,
          [agent.id, w.owner.userId],
        );
      },
      () => permit(token, action),
    );
    await expect(pending).resolves.toMatchObject({ code: "DENIED" });
    expect(await permits(w)).toBe(0);
  });

  test("a revocation that commits first always wins", async () => {
    const { w, agent, token, action } = await ready();
    const pending = losesRaceTo(
      async (query) => {
        await query(`SELECT 1 FROM nodrail.agents WHERE id = $1 FOR UPDATE`, [
          agent.id,
        ]);
        await query(
          `UPDATE nodrail.installation_credentials SET revoked_at = now()
       WHERE installation_id = $1 AND revoked_at IS NULL`,
          [agent.installationId],
        );
      },
      () => permit(token, action),
    );
    await rejects(pending, "UNAUTHENTICATED");
    expect(await permits(w)).toBe(0);
  });

  test("shows as allowed by rule in the history", async () => {
    const { w, token, action } = await ready();
    expectAllow(await permit(token, action));
    const { items } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { outcome: "allowed" }),
    );
    expect(items[0]).toMatchObject({
      code: "allowed_by_rule",
      action: { reference: action.reference },
    });
  });

  test("one installation cannot touch another's action", async () => {
    const { w, action } = await ready();
    const other = await rig();
    await rejects(permit(other.token, action), "NOT_FOUND");
    await rejects(status(other.token, action.action_id), "NOT_FOUND");
    await rejects(
      call(other.token, "reports:write-own", (context) =>
        reportOutcome(context, action.action_id, {
          report_key: "k",
          outcome: "success",
        }),
      ),
      "NOT_FOUND",
    );
    expect(await permits(w)).toBe(0);
  });
});

describe("status", () => {
  test("is found by the original key", async () => {
    const { token } = await rig();
    const key = randomUUID();
    const action = await submit(token, descriptor(), key);
    await expect(
      call(token, "actions:read-own", (context) =>
        findActionByKey(context, key),
      ),
    ).resolves.toMatchObject({ action_id: action.action_id });
    await rejects(
      call(token, "actions:read-own", (context) =>
        findActionByKey(context, "unknown"),
      ),
      "NOT_FOUND",
    );
  });

  test("reports a closed request as invalidated", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    const action = await submit(token);
    await owner(w, (context) => pauseAgent(context, "bot"));
    await expect(status(token, action.action_id)).resolves.toMatchObject({
      code: "INVALIDATED",
      reason: "agent_paused",
    });
  });

  test("never contains a permit", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    const action = await submit(token);
    expectAllow(await permit(token, action));
    const seen = await status(token, action.action_id);
    expect(seen).not.toHaveProperty("claim_nonce");
    expect(seen.code).not.toBe("ALLOW");
  });
});

describe("client reports", () => {
  const report = (
    token: string,
    actionId: string,
    body: object = { report_key: "k1", outcome: "success" },
  ) =>
    call(token, "reports:write-own", (context) =>
      reportOutcome(context, actionId, body),
    );

  test("are stored once, and change no decision", async () => {
    const { w, token } = await rig();
    await rule(w, { effect: "deny", name: "Stop" });
    const action = await submit(token);
    await report(token, action.action_id);
    await report(token, action.action_id);
    expect(
      await admin.getRepository(ClientReport).countBy({ workspaceId: w.id }),
    ).toBe(1);
    await expect(status(token, action.action_id)).resolves.toMatchObject({
      code: "DENIED",
    });
    const { items } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { view: "reports" }),
    );
    expect(items[0]).toMatchObject({
      outcome: "denied",
      latestReport: { outcome: "success" },
    });
  });

  test("can name only this action's permit", async () => {
    const { w, token } = await rig();
    await allowRule(w);
    const one = await submit(token);
    const two = await submit(token);
    const issued = expectAllow(await permit(token, one));
    await report(token, one.action_id, {
      report_key: "a",
      outcome: "success",
      permit_id: issued.permit_id,
    });
    await rejects(
      report(token, two.action_id, {
        report_key: "b",
        outcome: "success",
        permit_id: issued.permit_id,
      }),
      "INVALID_INPUT",
    );
  });

  test.each([
    ["bad outcome", { report_key: "k", outcome: "ran" }],
    ["no key", { outcome: "success" }],
    [
      "huge details",
      { report_key: "k", outcome: "success", details: { a: "x".repeat(9000) } },
    ],
  ])("refuses %s", async (_label, body) => {
    const { token } = await rig();
    const action = await submit(token);
    await rejects(report(token, action.action_id, body), "INVALID_INPUT");
  });
});

describe("rate limits", () => {
  const fillWindow = (agent: TestAgent, calls: number, offsetMinutes = 0) =>
    admin.query(
      `UPDATE nodrail.runtime_rate_windows
       SET calls = $2,
           window_start = date_trunc('minute', clock_timestamp())
             - make_interval(mins => $3)
       WHERE installation_id = $1`,
      [agent.installationId, calls, offsetMinutes],
    );

  async function limited() {
    const setup = await rig();
    await submit(setup.token);
    return setup;
  }

  test("refuses past the limit, creating nothing", async () => {
    const { w, agent, token } = await limited();
    await fillWindow(agent, 600);
    await rejects(submit(token), "RATE_LIMITED");
    const [row]: { n: number }[] = await admin.query(
      `SELECT count(*)::int AS n FROM nodrail.action_requests
       WHERE workspace_id = $1 AND installation_id = $2
         AND operation_key = 'issues.create'`,
      [w.id, agent.installationId],
    );
    expect(row?.n).toBe(1);
  });

  test("a new minute starts again", async () => {
    const { agent, token } = await limited();
    await fillWindow(agent, 600, 1);
    await expect(submit(token)).resolves.toBeDefined();
  });

  test("one installation's limit is its own", async () => {
    const { agent } = await limited();
    await fillWindow(agent, 600);
    const other = await rig("other");
    await expect(submit(other.token)).resolves.toBeDefined();
  });

  test("a bad credential does not count against the real one", async () => {
    const { agent, token } = await limited();
    await fillWindow(agent, 600);
    await rejects(submit(`${token.slice(0, -4)}aaaa`), "UNAUTHENTICATED");
    const [row]: { calls: number }[] = await admin.query(
      `SELECT calls FROM nodrail.runtime_rate_windows WHERE installation_id = $1`,
      [agent.installationId],
    );
    expect(row?.calls).toBe(600);
  });

  test("simultaneous calls are all counted", async () => {
    const { agent, token } = await limited();
    await fillWindow(agent, 590);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => submit(token)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  });
});

describe("check-ins", () => {
  test("mark the integration as reporting and finish setup", async () => {
    const { w, agent, token } = await rig();
    expect(
      (await readWorkspace(w.owner, w.id, (c) => getOverviewState(c, ENV)))
        .checkedIn,
    ).toBe(false);
    await call(token, "heartbeat:write", (context) =>
      recordHeartbeat(context, { adapter_version: "1.2.3" }),
    );
    const overview = await readWorkspace(w.owner, w.id, (c) =>
      getOverviewState(c, ENV),
    );
    expect(overview).toMatchObject({
      checkedIn: true,
      agents: { reporting: 1 },
    });
    expect(
      await admin.getRepository(Installation).findOneByOrFail({
        id: agent.installationId,
        workspaceId: w.id,
      }),
    ).toMatchObject({ adapterVersion: "1.2.3" });
  });

  test("still work while paused, and grant nothing", async () => {
    const { w, token } = await rig();
    await owner(w, (context) => pauseAgent(context, "bot"));
    await expect(
      call(token, "heartbeat:write", (context) => recordHeartbeat(context, {})),
    ).resolves.toEqual({ recorded: true });
  });
});
