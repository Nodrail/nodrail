import { actionDigest, descriptorDigest } from "@nodrail/client/protocol";
import { getActionStatus } from "@/server/modules/runtime";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { POST as action } from "@/app/api/v1/runtime/actions/route";
import { POST as reserve } from "@/app/api/v1/runtime/budgets/reserve/route";
import { GET as access } from "@/app/api/v1/runtime/access/route";
import { POST as decisions } from "@/app/api/v1/runtime/decisions/route";
import { GET as policy } from "@/app/api/v1/runtime/policy/route";
import { POST as steps } from "@/app/api/v1/runtime/steps/route";
import { POST as inventory } from "@/app/api/v1/runtime/inventory/route";
import { readWorkspace, withRuntime, withWorkspace } from "@/server/db/context";
import { lateHostReport } from "@/contracts/v1/activity";
import { listActivity } from "@/server/modules/activity";
import {
  listInventory,
  publishIntendedRevision,
} from "@/server/modules/inventory";
import { getRun, listRuns } from "@/server/modules/runs";
import { pauseAgent, resumeAgent } from "@/server/modules/agents";
import { requestPermit, submitAction } from "@/server/modules/runtime";
import { postJson } from "./reporting-world";
import { publishPlanned } from "@/server/modules/policies/publish";
import { plan } from "@/server/modules/policies/rule-files";
import {
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  useDatabase,
} from "./world";

useDatabase();
const segment = { params: Promise.resolve({}) };

const workspaceRevision = "a".repeat(64);
const rules = `- rule: Support edits
  agent: support
  tool: files
  operation: file.write
  resource: { kind: file, match: any }
  effect: allow
`;
const digestOf = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const fileWrite = (id: string, params: Record<string, string> = {}) => ({
  tool: "files",
  operation: "file.write",
  resource: { kind: "file", id },
  params,
});

function publishPin(
  workspace: Awaited<ReturnType<typeof createWorkspace>>,
  project: string,
  yaml = rules,
) {
  return withWorkspace(workspace.owner, workspace.id, async (context) => {
    // Seed policy history independently of how management authorizes takeover.
    const environment = workspace.environmentId;
    const pinned = await plan(context, environment, yaml);
    expect(pinned.issues).toEqual([]);
    return publishPlanned(context, environment, pinned, {
      source: yaml,
      managed: {
        project_id: project,
        revision: workspaceRevision,
        policy_revision: digestOf(yaml),
      },
    });
  });
}

async function enrolledHost() {
  const workspace = await createWorkspace();
  const host = await createAgent(workspace, "fallback-host", [workspace.owner]);
  const support = await createAgent(workspace, "support");
  const marketing = await createAgent(workspace, "marketing");
  const project = randomUUID();
  const machine = randomUUID();
  const token = await issueToken(workspace, host);
  await admin.query(
    `UPDATE nodrail.installations SET enrollment_project_id = $2,
       enrollment_machine_id = $3, enrollment_agent_keys = ARRAY['support', 'marketing']
     WHERE id = $1`,
    [host.installationId, project, machine],
  );
  await admin.query(
    "UPDATE nodrail.agents SET managed_project_id = $1 WHERE id = $2",
    [project, support.id],
  );
  await admin.query(
    "UPDATE nodrail.agents SET managed_project_id = $1 WHERE id = $2",
    [randomUUID(), marketing.id],
  );
  await publishPin(workspace, project);
  const getAccess = (agent: string, call?: string) =>
    access(
      new NextRequest(
        new URL(
          `/api/v1/runtime/access?${agent ? `agent=${agent}&` : ""}policy_digest=${digestOf(rules)}&workspace_revision=${workspaceRevision}${call ? `&call=${encodeURIComponent(call)}` : ""}`,
          "https://test.invalid",
        ),
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
      segment,
    );
  const proof = async (agent: string, key: string) => {
    const response = await getAccess(agent, key);
    expect(response.status).toBe(200);
    const { admission_id } = await response.json();
    expect(admission_id).toMatch(/^local-v1\.\d+\.[A-Za-z0-9_-]{43}$/);
    return admission_id as string;
  };
  return {
    workspace,
    support,
    marketing,
    host,
    project,
    machine,
    token,
    getAccess,
    proof,
  };
}

test("fresh access and Activity use the enrollment's admitted caller", async () => {
  const { workspace, project, token, getAccess, proof } = await enrolledHost();
  const first = await getAccess("support");
  expect(first.headers.get("cache-control")).toContain("no-store");
  expect(await first.json()).toMatchObject({
    agent: "support",
    paused: false,
    project_id: project,
  });
  expect(await (await getAccess("marketing")).json()).toMatchObject({
    agent: "fallback-host",
    paused: false,
  });

  const items = ["support", "marketing"].map((agent) => ({
    agent,
    idempotency_key: randomUUID(),
    tool: "files",
    operation: "file.write",
    resource: { kind: "file", id: "redacted" },
    params: {},
    verdict: "would_deny",
    run: { key: "no-steps" },
    decided_at: new Date().toISOString(),
    policy_digest: digestOf(rules),
  }));
  const { json: payload } = await postJson(
    decisions,
    "runtime/decisions",
    token,
    {
      decisions: await Promise.all(
        items.map(async (item) => ({
          ...item,
          admission_id: await proof(item.agent, item.idempotency_key),
        })),
      ),
    },
  );
  expect(payload.results).toEqual(
    items.map(({ idempotency_key }) => ({
      key: idempotency_key,
      action_id: expect.any(String),
    })),
  );
  const supportId = payload.results[0].action_id as string;
  const { POST: report } =
    await import("@/app/api/v1/runtime/actions/[id]/reports/route");
  const path = `/api/v1/runtime/actions/${supportId}/reports`;
  const reported = await report(
    new NextRequest(new URL(path, "https://test.invalid"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ report_key: "done", outcome: "success" }),
    }),
    {
      params: Promise.resolve({ id: supportId }),
    },
  );
  expect(reported.status).toBe(200);
  const rows = await readWorkspace(workspace.owner, workspace.id, (context) =>
    listActivity(context, "development", {}),
  );
  expect(rows.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "would_deny",
        agentKey: "support",
        latestReport: expect.objectContaining({
          outcome: "success",
          mismatch: false,
        }),
      }),
      expect.objectContaining({
        code: "would_deny",
        agentKey: "fallback-host",
      }),
    ]),
  );
  await readWorkspace(workspace.owner, workspace.id, async (context) => {
    const { runs } = await listRuns(context, "development", {
      agent: "support",
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentKey: "support",
      actions: 2,
      steps: 0,
      agents: expect.arrayContaining([
        { agent: "support", steps: 0, finished: false, verdict: null },
      ]),
    });
    const run = await getRun(context, "development", runs[0]!.id);
    expect(run.timeline).toMatchObject([
      { kind: "action", action: { agent: "support" } },
      { kind: "action", action: { agent: "fallback-host" } },
    ]);
  });
});

test("Inventory accepts bounded observations only for the authenticated enrollment", async () => {
  const { workspace, project, machine, token, marketing, host } =
    await enrolledHost();
  const observation = {
    host: "claude-code",
    agent: "support",
    activation: "configured",
    drift: 0,
    in_step: true,
    unmanaged: { skill: 2 },
    applied_revision: null,
    locked_revision: null,
  };
  const post = (credential: string, body: unknown) =>
    postJson(inventory, "runtime/inventory", credential, body);
  expect((await post("invalid", observation)).status).toBe(401);
  expect(
    (await post(await issueToken(workspace, marketing), observation)).status,
  ).toBe(403);
  expect(
    (await post(token, { ...observation, environment: "production" })).status,
  ).toBe(422);
  expect(
    (await post(token, { ...observation, unmanaged: { skill: 1_000_000 } }))
      .status,
  ).toBe(422);
  expect((await post(token, observation)).status).toBe(200);
  const inEnv = (environment: string) =>
    readWorkspace(workspace.owner, workspace.id, (context) =>
      listInventory(context, environment),
    );
  expect((await inEnv("development")).rows).toEqual([
    expect.objectContaining({
      project,
      machine: machine.slice(0, 8),
      agent: "support",
      unmanaged: { skill: 2 },
    }),
  ]);
  const before = (await inEnv("development")).rows[0]!;
  const staleDigest = "f".repeat(64);
  expect(
    (
      await post(token, {
        host: "claude-code",
        heartbeat: true,
        applied_revision: staleDigest,
        locked_revision: staleDigest,
      })
    ).status,
  ).toBe(200);
  expect((await inEnv("development")).rows[0]).toEqual(before);
  const [{ updated }]: { updated: boolean }[] = await admin.query(
    "SELECT last_seen_at > observed_at AS updated FROM nodrail.inventory_reports WHERE workspace_id = $1",
    [workspace.id],
  );
  expect(updated).toBe(true);
  expect((await inEnv("production")).rows).toEqual([]);
  await admin.query(
    `UPDATE nodrail.runtime_rate_windows SET calls = 600,
       window_start = date_trunc('minute', clock_timestamp())
     WHERE workspace_id = $1 AND installation_id = $2`,
    [workspace.id, host.installationId],
  );
  expect((await post(token, observation)).status).toBe(429);
});

test("server authorization and permits evaluate the agent admitted on submission", async () => {
  const { token } = await enrolledHost();
  const submit = (agent: string) =>
    withRuntime(token, "actions:submit", (context) =>
      submitAction(context, randomUUID(), {
        agent,
        tool: "files",
        operation: "file.write",
        resource: { kind: "file", id: "src/example.ts" },
        params: {},
      }),
    );
  expect((await submit("marketing")).code).toBe("DENIED");
  const allowed = await submit("support");
  expect(allowed.code).toBe("READY");
  const permit = await withRuntime(token, "permits:request", (context) =>
    requestPermit(context, allowed.action_id, {
      action_digest: allowed.action_digest,
      nonce: randomUUID(),
    }),
  );
  expect(permit.code).toBe("ALLOW");
});

test("pausing a machine blocks both caller paths and invalidates pending authorization", async () => {
  const { workspace, token, getAccess } = await enrolledHost();
  const submit = () =>
    withRuntime(token, "actions:submit", (context) =>
      submitAction(context, randomUUID(), {
        agent: "support",
        tool: "files",
        operation: "file.write",
        resource: { kind: "file", id: "src/example.ts" },
        params: {},
      }),
    );
  const pending = await submit();
  expect(pending.code).toBe("READY");
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "fallback-host"),
  );
  for (const agent of ["support", "unknown", ""]) {
    expect(await (await getAccess(agent)).json()).toMatchObject({
      paused: true,
    });
  }
  await expect(submit()).rejects.toMatchObject({
    code: "FORBIDDEN",
    detail: expect.stringContaining("fallback-host"),
  });
  expect(
    await postJson(steps, "runtime/steps", token, {
      agent: "support",
      event: "started",
      run: { key: "paused" },
      step: { id: "s", agent: "support" },
      policy_digest: digestOf(rules),
    }),
  ).toMatchObject({ status: 403 });
  const permit = () =>
    withRuntime(token, "permits:request", (context) =>
      requestPermit(context, pending.action_id, {
        action_digest: pending.action_digest,
        nonce: randomUUID(),
      }),
    );
  expect((await permit()).code).toBe("DENIED");
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    resumeAgent(context, "fallback-host"),
  );
  expect((await permit()).code).toBe("INVALIDATED");
});

test("pausing a declared agent refuses unidentified callers across runtime admission paths", async () => {
  const { workspace, marketing, project, token, getAccess } =
    await enrolledHost();
  await admin.query(
    "UPDATE nodrail.agents SET managed_project_id = $1 WHERE id = $2",
    [project, marketing.id],
  );
  const input = {
    tool: "files",
    operation: "file.write",
    resource: { kind: "file", id: "src/example.ts" },
    params: {},
  };
  const pending = await withRuntime(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), input),
  );
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "support"),
  );
  for (const agent of [undefined, "unknown"]) {
    expect(await (await getAccess(agent ?? "")).json()).toMatchObject({
      paused: true,
      reason: expect.stringContaining("support"),
    });
    const submitted = await postJson(
      action,
      "runtime/actions",
      token,
      { ...input, agent },
      { "idempotency-key": randomUUID() },
    );
    expect(submitted).toMatchObject({
      status: 403,
      json: { error: { message: expect.stringContaining("support") } },
    });
    expect(
      await postJson(steps, "runtime/steps", token, {
        agent,
        event: "started",
        run: { key: "unidentified" },
        step: { id: "step", agent: "support" },
        policy_digest: digestOf(rules),
      }),
    ).toMatchObject({
      status: 403,
      json: { error: { message: expect.stringContaining("support") } },
    });
    expect(
      await postJson(decisions, "runtime/decisions", token, {
        decisions: [
          {
            ...input,
            agent,
            verdict: "allow",
            idempotency_key: randomUUID(),
            policy_digest: digestOf(rules),
            decided_at: new Date().toISOString(),
          },
        ],
      }),
    ).toMatchObject({
      json: {
        results: [{ status: lateHostReport }],
      },
    });
    expect(
      await postJson(reserve, "runtime/budgets/reserve", token, {
        calls: [{ tool: input.tool, operation: input.operation }],
        agent,
        call_fingerprint: `sha256:${"a".repeat(64)}`,
        policy_digest: digestOf(rules),
      }),
    ).toMatchObject({ json: { reason: expect.stringContaining("support") } });
  }
  expect(
    await withRuntime(token, "permits:request", (context) =>
      requestPermit(context, pending.action_id, {
        action_digest: pending.action_digest,
        nonce: randomUUID(),
      }),
    ),
  ).toMatchObject({
    code: "DENIED",
    reason: expect.stringContaining("support"),
  });
  expect(await (await getAccess("marketing")).json()).toMatchObject({
    agent: "marketing",
    paused: false,
  });
  await expect(
    withRuntime(token, "actions:submit", (context) =>
      submitAction(context, randomUUID(), { ...input, agent: "marketing" }),
    ),
  ).resolves.toMatchObject({ action_id: expect.any(String) });
});

test("a declared-agent pause follows the reported caller and a machine pause blocks all callers", async () => {
  const { workspace, marketing, project, getAccess } = await enrolledHost();
  await admin.query(
    "UPDATE nodrail.agents SET managed_project_id = $1 WHERE id = $2",
    [project, marketing.id],
  );
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "support"),
  );
  expect(await (await getAccess("support")).json()).toMatchObject({
    agent: "support",
    paused: true,
  });
  expect(await (await getAccess("marketing")).json()).toMatchObject({
    agent: "marketing",
    paused: false,
  });
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "fallback-host"),
  );
  for (const agent of ["support", "marketing", "unknown", ""])
    expect(await (await getAccess(agent)).json()).toMatchObject({
      paused: true,
    });
});

test("verified history binds server admission to this call and access epoch, independent of host time", async () => {
  const { workspace, token, proof } = await enrolledHost();
  const key = randomUUID();
  const before = await proof("support", key);
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "support"),
  );
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    resumeAgent(context, "support"),
  );
  const fresh = randomUUID();
  const current = await proof("support", fresh);
  const item = {
    agent: "support",
    ...fileWrite("example.ts"),
    verdict: "allow",
    policy_digest: digestOf(rules),
  };
  const report = async (
    idempotency_key: string,
    decided_at: string,
    admission_id?: string,
  ) => {
    const result = await postJson(decisions, "runtime/decisions", token, {
      decisions: [{ ...item, idempotency_key, decided_at, admission_id }],
    });
    return result.json.results[0];
  };
  const future = "2099-01-01T00:00:00.000Z";
  const wrongCaller = randomUUID();
  const wrongProof = await proof("marketing", wrongCaller);
  for (const historical of [
    await report(key, future, before),
    await report(randomUUID(), future, current),
    await report(randomUUID(), future),
    await report(wrongCaller, future, wrongProof),
  ]) {
    expect(historical).toMatchObject({
      action_id: expect.any(String),
      status: lateHostReport,
    });
  }
  const verified = await report(fresh, "2001-01-01T00:00:00.000Z", current);
  expect(verified).toEqual({ key: fresh, action_id: expect.any(String) });
  const { items } = await readWorkspace(
    workspace.owner,
    workspace.id,
    (context) => listActivity(context, "development", { kind: "decisions" }),
  );
  expect(items.filter(({ host }) => host)).toHaveLength(1);
});

test("server pause denials are redacted, replay safely, and only join existing runs", async () => {
  const { workspace, token, host } = await enrolledHost();
  const input = {
    agent: "support",
    ...fileWrite("src/sensitive-path.ts", { text: "sensitive-argument" }),
  };
  const pending = await withRuntime(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), { ...input, run: { key: "existing" } }),
  );
  expect(pending.code).toBe("READY");
  const runs = () =>
    admin.query(
      "SELECT id, key, last_activity_at FROM nodrail.runs WHERE workspace_id = $1",
      [workspace.id],
    );
  const before = await runs();
  expect(before).toHaveLength(1);
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    pauseAgent(context, "support"),
  );
  const submit = (run: string, key: string) =>
    postJson(
      action,
      "runtime/actions",
      token,
      {
        ...input,
        run: { key: run, step: { id: "never-started", agent: "support" } },
      },
      { "idempotency-key": key },
    );
  const key = randomUUID();
  for (const result of [
    await submit("existing", key),
    await submit("existing", key),
    await submit("never-created", randomUUID()),
  ])
    expect(result.status).toBe(403);

  const permit = () =>
    withRuntime(token, "permits:request", (context) =>
      requestPermit(context, pending.action_id, {
        action_digest: pending.action_digest,
        nonce: randomUUID(),
      }),
    );
  for (const result of [await permit(), await permit()])
    expect(result).toMatchObject({ code: "DENIED", reason: "agent_paused" });

  const matches = await readWorkspace(
    workspace.owner,
    workspace.id,
    async (context) => {
      const activity = await listActivity(context, "development", {
        kind: "decisions",
      });
      const denied = activity.items.filter(
        ({ code }) => code === "denied_agent_paused",
      );
      const run = await getRun(context, "development", before[0].id);
      expect(
        run.timeline.flatMap((entry) =>
          entry.kind === "action" ? [entry.action.pauseDenial ?? null] : [],
        ),
      ).toEqual([null, "Denied: support paused", "Denied: support paused"]);
      return denied;
    },
  );
  expect(matches).toHaveLength(3);
  expect(matches.filter(({ action }) => action?.run)).toHaveLength(2);
  for (const decision of matches)
    expect(decision).toMatchObject({
      agentKey: "support",
      outcome: "denied",
      label: "Denied: support paused",
      action: { resource: "redacted" },
    });
  expect(await runs()).toEqual(before);
  expect(
    await admin.query(
      "SELECT step_key FROM nodrail.run_steps WHERE workspace_id = $1",
      [workspace.id],
    ),
  ).toEqual([]);
  const rows: { id: string; resource_id: string; params_safe: object }[] =
    await admin.query(
      "SELECT id, resource_id, params_safe FROM nodrail.action_requests WHERE workspace_id = $1 AND access_epoch = 0",
      [workspace.id],
    );
  expect(rows).toEqual(
    Array.from({ length: 3 }, () => ({
      id: expect.any(String),
      resource_id: "redacted",
      params_safe: {},
    })),
  );
  const digest = descriptorDigest(host.installationId, {
    tool: input.tool,
    operation: input.operation,
    resource: { ...input.resource, id: "redacted" },
    params: {},
  });
  const persisted = await admin.query(
    "SELECT descriptor_digest FROM nodrail.action_requests WHERE id = ANY($1::uuid[])",
    [rows.map(({ id }) => id)],
  );
  expect(persisted).toEqual(rows.map(() => ({ descriptor_digest: digest })));
  const old = rows[0]!.id;
  const original = descriptorDigest(host.installationId, input);
  await admin.query(
    "UPDATE nodrail.action_requests SET descriptor_digest = $2, action_digest = $3 WHERE id = $1",
    [old, original, actionDigest(old, original)],
  );
  for (const row of rows) {
    const status = await withRuntime(token, "actions:read-own", (context) =>
      getActionStatus(context, row.id),
    );
    expect(status.descriptor_digest).toBe(digest);
    expect(status.action_digest).toBe(actionDigest(row.id, digest));
  }
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    resumeAgent(context, "support"),
  );
  vi.stubEnv(
    "NODRAIL_ADMISSION_KEYS",
    JSON.stringify({
      current: "rotated",
      keys: { rotated: { secret: randomBytes(32).toString("hex") } },
    }),
  );
  try {
    const replay = await withRuntime(token, "actions:submit", (context) =>
      submitAction(context, key, { ...input, run: { key: "existing" } }),
    );
    expect(replay).toMatchObject({ code: "DENIED", descriptor_digest: digest });
    await expect(
      withRuntime(token, "actions:submit", (context) =>
        submitAction(context, key, { ...input, params: { text: "changed" } }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  } finally {
    vi.unstubAllEnvs();
  }
});

test("an unverified pause stays redacted in a held run without changing its status", async () => {
  const { workspace, token } = await enrolledHost();
  const run = { key: "held-run" };
  const descriptor = {
    ...fileWrite("src/sensitive-path.ts", { text: "sensitive-argument" }),
  };
  const pending = await withRuntime(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      ...descriptor,
      agent: "support",
      run,
    }),
  );
  await admin.query(
    `UPDATE nodrail.action_requests
    SET run_hold = '{"kind":"gate","id":"qa","name":"QA"}'::jsonb WHERE id = $1`,
    [pending.action_id],
  );
  const item = {
    ...descriptor,
    agent: "support",
    verdict: "deny",
    paused_agents: ["support"],
    idempotency_key: randomUUID(),
    reason: "sensitive-reason",
    run,
    decided_at: new Date().toISOString(),
    policy_digest: digestOf(rules),
  };
  const result = await postJson(decisions, "runtime/decisions", token, {
    decisions: [item],
  });
  expect(result.json.results).toMatchObject([
    { status: lateHostReport, action_id: expect.any(String) },
  ]);
  await readWorkspace(workspace.owner, workspace.id, async (context) => {
    const activity = await listActivity(context, "development", {});
    expect(activity.items.find(({ host }) => host)).toMatchObject({
      code: "host_reported_late",
      label: lateHostReport,
      action: { resource: "redacted" },
    });
    const {
      runs: [summary],
    } = await listRuns(context, "development");
    expect(summary).toMatchObject({ key: run.key, status: "held", actions: 2 });
    const detail = await getRun(context, "development", summary!.id);
    expect(
      detail.timeline.filter(({ kind }) => kind === "action"),
    ).toHaveLength(2);
    expect(JSON.stringify(detail.timeline)).not.toContain("sensitive-reason");
  });
});

test("a takeover returns the new owner to the previous project's hosts", async () => {
  const { workspace, token, getAccess } = await enrolledHost();
  const owner = randomUUID();
  const next = rules.replace("Support edits", "Another owner");
  await publishPin(workspace, owner, next);
  await withWorkspace(workspace.owner, workspace.id, (context) =>
    publishIntendedRevision(context, "development", {
      project_id: owner,
      project: "New owner",
      revision: workspaceRevision,
      policy_revision: digestOf(next),
      files: [],
    }),
  );
  const taken = await getAccess("support");
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({
    error: { message: expect.stringContaining("New owner") },
  });

  const oldHost = await policy(
    new NextRequest("https://test.invalid/api/v1/runtime/policy", {
      headers: { authorization: `Bearer ${token}` },
    }),
    segment,
  );
  expect(await oldHost.json()).toMatchObject({
    error: {
      code: "RULE_CHANGED",
      message: expect.stringContaining("New owner"),
    },
  });
});

test("publishing a new same-project pin keeps the earlier revision eligible, with no cross-project reports", async () => {
  const { workspace, project, token, getAccess } = await enrolledHost();
  const foreign = rules.replace("Support edits", "Foreign edits");
  await publishPin(workspace, randomUUID(), foreign);
  await publishPin(
    workspace,
    project,
    rules.replace("Support edits", "Support edits v2"),
  );
  expect((await getAccess("support")).status).toBe(200);
  const report = (digest: string) =>
    postJson(decisions, "runtime/decisions", token, {
      decisions: [
        {
          agent: "support",
          idempotency_key: randomUUID(),
          verdict: "deny",
          tool: "files",
          operation: "file.write",
          resource: { kind: "file", id: "redacted" },
          params: {},
          policy_digest: digest,
          decided_at: new Date().toISOString(),
        },
      ],
    });
  expect((await report(digestOf(rules))).json.results[0]).toHaveProperty(
    "action_id",
  );
  expect((await report(digestOf(foreign))).json.results[0]).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  const step = (digest: string) =>
    postJson(steps, "runtime/steps", token, {
      agent: "support",
      event: "started",
      policy_digest: digest,
      run: { key: "test" },
      step: { id: "s", agent: "support" },
    });
  expect((await step(digestOf(foreign))).status).toBe(404);
  expect((await step(digestOf(rules))).status).toBe(200);
});
