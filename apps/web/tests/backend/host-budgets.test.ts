import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { POST as reportRoute } from "@/app/api/v1/runtime/actions/[id]/reports/route";
import { POST as reserveRoute } from "@/app/api/v1/runtime/budgets/reserve/route";
import { POST as startRoute } from "@/app/api/v1/runtime/budgets/start/route";
import { POST as settleRoute } from "@/app/api/v1/runtime/budgets/settle/route";
import { POST as decisionsRoute } from "@/app/api/v1/runtime/decisions/route";
import { POST as heartbeatRoute } from "@/app/api/v1/runtime/heartbeat/route";
import { GET as identityRoute } from "@/app/api/v1/runtime/identity/route";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { budgetStatus } from "@/server/modules/budgets/read";
import { reconcileReservation } from "@/server/modules/budgets/reconcile";
import { postJson } from "./reporting-world";
import { ENV, publish } from "./runs-world";
import {
  admin,
  createAgent,
  inEachMode,
  issueToken,
  useDatabase,
  workspaceWithToken,
} from "./world";

useDatabase();

const POLICY = `- required_engine_version: 5
- rule: Publish
  tool: outbox
  operation: publish
  resource: { kind: mcp_tool, match: any }
  effect: allow
- budget: Shared publishing
  id: daily
  count: { tool: outbox, operation: publish }
  limit: 1
  per: day
  timezone: UTC
  across: environment
  otherwise: deny
`;
const digestOf = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const call = { tool: "outbox", operation: "publish" };
const reservation = () => ({
  call_fingerprint: randomUUID(),
  policy_digest: digestOf(POLICY),
  calls: [call],
});
const reserve = (token: string, body: unknown) =>
  postJson(reserveRoute, "runtime/budgets/reserve", token, body);
const start = (
  token: string,
  request: ReturnType<typeof reservation>,
  claim_id = randomUUID(),
) =>
  postJson(startRoute, "runtime/budgets/start", token, {
    call_fingerprint: request.call_fingerprint,
    policy_digest: request.policy_digest,
    claim_id,
  });
const settle = (
  token: string,
  request: ReturnType<typeof reservation>,
  fields: object = {},
) =>
  postJson(settleRoute, "runtime/budgets/settle", token, {
    call_fingerprint: request.call_fingerprint,
    policy_digest: request.policy_digest,
    outcome: "failure",
    ...fields,
  });

async function setup() {
  const { w, token, agent } = await workspaceWithToken();
  await publish(w, POLICY);
  const other = await issueToken(w, await createAgent(w, "second"));
  return { w, token, other, agent };
}

async function decision(
  token: string,
  id: string,
  digest = digestOf(POLICY),
  verdict = "allow",
  decidedAt = new Date().toISOString(),
) {
  const answer = await postJson(decisionsRoute, "runtime/decisions", token, {
    decisions: [
      {
        ...call,
        idempotency_key: id,
        policy_digest: digest,
        verdict,
        resource: { kind: "mcp_tool", id: "outbox.publish" },
        params: {},
        decided_at: decidedAt,
      },
    ],
  });
  expect(answer.json.results[0]).toHaveProperty("action_id");
  return answer.json.results[0].action_id as string;
}

async function outcome(token: string, id: string, outcome: string) {
  return reportRoute(
    new NextRequest(`http://localhost/api/v1/runtime/actions/${id}/reports`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ report_key: randomUUID(), outcome }),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function identity(token: string) {
  const answer = await identityRoute(
    new NextRequest("http://localhost/api/v1/runtime/identity", {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({}) },
  );
  expect(answer.status).toBe(200);
  return answer.json();
}

function expire(workspaceId: string) {
  return admin.query(
    `UPDATE nodrail.budget_reservations
     SET created_at = now() - interval '10 minutes', unknown_after = now() - interval '5 minutes'
     WHERE workspace_id = $1 AND state = 'reserved'`,
    [workspaceId],
  );
}

function setScopes(
  workspaceId: string,
  installationId: string,
  scopes: string[],
) {
  return admin.query(
    "UPDATE nodrail.installation_credentials SET scopes = $3 WHERE workspace_id = $1 AND installation_id = $2",
    [workspaceId, installationId, scopes],
  );
}

inEachMode(() => {
  test("concurrent installations share a limit; replays take no extra slot", async () => {
    const { w, token, other } = await setup();
    const request = reservation();
    const callers = [token, other];
    const responses = await Promise.all(
      callers.map((caller) => reserve(caller, request)),
    );
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const winner = responses.findIndex(({ json }) => json.expires_at !== null);
    expect(winner).toBeGreaterThanOrEqual(0);
    const winning = callers[winner]!;
    const losing = callers[1 - winner]!;
    expect(responses[1 - winner]!.json).toMatchObject({
      expires_at: null,
      limits: [{ state: "over" }],
    });
    expect(await reserve(winning, request)).toEqual(responses[winner]);
    expect(
      (await reserve(winning, { ...request, run: { key: "changed" } })).status,
    ).toBe(409);

    const claimIds = [randomUUID(), randomUUID()];
    const starts = await Promise.all(
      claimIds.map((id) => start(winning, request, id)),
    );
    const winners = starts.filter(({ json }) => json.claim_id !== null);
    expect(winners).toHaveLength(1);
    expect(claimIds).toContain(winners[0]!.json.claim_id);
    expect(
      (await start(winning, request, winners[0]!.json.claim_id)).json.claim_id,
    ).toBeNull();

    const action = await decision(winning, request.call_fingerprint);
    expect((await outcome(winning, action, "success")).status).toBe(200);
    expect((await outcome(winning, action, "failure")).status).toBe(200);
    const [row] = await admin.query(
      "SELECT state, permit_id FROM nodrail.budget_reservations WHERE workspace_id = $1 AND action_request_id = $2",
      [w.id, action],
    );
    expect(row).toEqual({ state: "consumed", permit_id: null });
    expect((await reserve(losing, reservation())).json).toMatchObject({
      expires_at: null,
    });
  });

  test("started work stays charged after its start deadline and accepts a late result", async () => {
    const { w, token, other } = await setup();
    const request = reservation();
    expect((await reserve(token, request)).json.expires_at).toEqual(
      expect.any(String),
    );
    expect((await settle(token, request)).status).toBe(409);
    expect((await start(token, request)).json.claim_id).toEqual(
      expect.any(String),
    );
    expect((await settle(other, request)).status).toBe(404);
    await expire(w.id);

    expect((await reserve(other, reservation())).json.limits).toMatchObject([
      { state: "over", reserved: 1 },
    ]);
    const status = await readWorkspace(w.owner, w.id, (context) =>
      budgetStatus(context, ENV),
    );
    expect(status.unknown).toEqual([
      expect.objectContaining({ shownAs: "unknown" }),
    ]);
    expect(
      (await settle(token, request, { policy_digest: "f".repeat(64) })).status,
    ).toBe(409);
    expect((await settle(token, request, { outcome: "success" })).status).toBe(
      200,
    );
    expect((await settle(token, request)).status).toBe(200);
    expect((await reserve(other, reservation())).json.limits).toMatchObject([
      { state: "over", reserved: 0, used: 1 },
    ]);
  });

  test("unstarted leases expire and a closed window cannot be started", async () => {
    const { w, token, other } = await setup();
    const seed = reservation();
    expect((await reserve(token, seed)).json.expires_at).toEqual(
      expect.any(String),
    );
    await expire(w.id);
    const [window] = await admin.query(
      `WITH closed_soon AS (
        UPDATE nodrail.budget_windows
        SET starts_at = now() - interval '1 day',
            ends_at = date_trunc('milliseconds', now() + interval '30 seconds')
        WHERE workspace_id = $1 RETURNING ends_at
      )
      SELECT ends_at FROM closed_soon`,
      [w.id],
    );
    const request = reservation();
    expect((await reserve(token, request)).json.expires_at).toBe(
      window.ends_at.toISOString(),
    );
    // Model a host resuming across reset with its lease timer still showing time.
    await admin.query(
      `UPDATE nodrail.budget_windows
       SET starts_at = now() - interval '1 day', ends_at = now() - interval '1 second'
       WHERE workspace_id = $1`,
      [w.id],
    );
    expect((await start(token, request)).json.claim_id).toBeNull();
    await expire(w.id);
    expect((await reserve(token, request)).json).toMatchObject({
      expires_at: null,
      reason: expect.stringContaining("expired"),
    });
    await admin.query(
      "UPDATE nodrail.budget_windows SET ends_at = now() + interval '1 hour' WHERE workspace_id = $1",
      [w.id],
    );
    expect((await reserve(other, reservation())).json.expires_at).toEqual(
      expect.any(String),
    );
  });

  test("decision-first delivery cannot create a stranded reservation and replay reattaches a started lease", async () => {
    const { w, token } = await setup();
    const early = reservation();
    const action = await decision(token, early.call_fingerprint);
    expect((await outcome(token, action, "success")).status).toBe(200);
    expect((await reserve(token, early)).json).toMatchObject({
      expires_at: null,
      reason: expect.stringContaining("already decided"),
    });
    expect((await start(token, early)).json.claim_id).toBeNull();

    const held = reservation();
    expect((await reserve(token, held)).json.expires_at).toEqual(
      expect.any(String),
    );
    expect((await start(token, held)).json.claim_id).toEqual(
      expect.any(String),
    );
    const when = new Date().toISOString();
    const record = () =>
      decision(token, held.call_fingerprint, held.policy_digest, "allow", when);
    const id = await record();
    await admin.query(
      "UPDATE nodrail.budget_reservations SET action_request_id = NULL WHERE workspace_id = $1",
      [w.id],
    );
    expect(await record()).toBe(id);
    expect((await outcome(token, id, "success")).status).toBe(200);
    expect(
      await admin.query(
        "SELECT state, action_request_id FROM nodrail.budget_reservations WHERE workspace_id = $1",
        [w.id],
      ),
    ).toEqual([{ state: "consumed", action_request_id: id }]);
  });

  test("reserve and decision credentials cannot release a started lease", async () => {
    const { w, token, other, agent } = await setup();
    const request = reservation();
    await reserve(token, request);
    await start(token, request);
    await setScopes(w.id, agent.installationId, [
      "budgets:reserve",
      "decisions:write",
    ]);
    expect((await settle(token, request)).status).toBe(403);
    const denied = await decision(
      token,
      request.call_fingerprint,
      request.policy_digest,
      "deny",
    );
    expect((await outcome(token, denied, "failure")).status).toBe(403);
    expect((await reserve(other, reservation())).json.limits).toMatchObject([
      { state: "over" },
    ]);
    await setScopes(w.id, agent.installationId, ["reports:write-own"]);
    expect((await settle(token, request)).status).toBe(200);
    expect((await reserve(other, reservation())).json.expires_at).toEqual(
      expect.any(String),
    );
  });

  test("shares per-run measured budgets and counts an explicit reading", async () => {
    const { w, token } = await workspaceWithToken();
    const other = await issueToken(w, await createAgent(w, "second"));
    const policy = `- required_engine_version: 5
- rule: Dispatch
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow
- budget: Shared tokens
  id: tokens
  tokens: 10
  source: measured
  per: run
  across: environment
`;
    await publish(w, policy);
    const body = (key: string) => ({
      call_fingerprint: randomUUID(),
      policy_digest: digestOf(policy),
      calls: [{ tool: "claude-code", operation: "agent" }],
      run: { key },
    });
    const first = body("joint");
    expect((await reserve(token, first)).json.expires_at).toEqual(
      expect.any(String),
    );
    expect((await reserve(other, body("joint"))).json).toMatchObject({
      expires_at: null,
      limits: [{ state: "unknown", unread: 1 }],
    });
    expect((await start(token, first)).json.claim_id).toEqual(
      expect.any(String),
    );
    expect(
      (await settle(token, first, { outcome: "success", tokens: 10 })).status,
    ).toBe(200);
    expect((await reserve(other, body("joint"))).json).toMatchObject({
      expires_at: null,
      limits: [{ state: "over", used: 10 }],
    });
    expect((await reserve(other, body("different"))).json.expires_at).toEqual(
      expect.any(String),
    );
  });

  test("an unattached unknown lease can be reconciled", async () => {
    const { w, token, other } = await setup();
    const key = reservation();
    expect((await reserve(token, key)).json.expires_at).toEqual(
      expect.any(String),
    );
    expect((await start(token, key)).json.claim_id).toEqual(expect.any(String));
    expect((await settle(token, key, { outcome: "unknown" })).status).toBe(200);
    const { unknown } = await readWorkspace(w.owner, w.id, (context) =>
      budgetStatus(context, ENV),
    );
    expect(unknown).toEqual([
      expect.objectContaining({ actionId: null, shownAs: "unknown" }),
    ]);
    await withWorkspace(w.owner, w.id, (context) =>
      reconcileReservation(context, ENV, unknown[0]!.id, {
        state: "released",
        note: "Verified no work occurred.",
      }),
    );
    expect((await reserve(other, reservation())).json.expires_at).toEqual(
      expect.any(String),
    );
  });

  test("a new publication prevents an unstarted lease from being claimed or settled", async () => {
    const { w, token } = await setup();
    const held = reservation();
    expect((await reserve(token, held)).json.expires_at).toEqual(
      expect.any(String),
    );
    const newer = POLICY.replace("  limit: 1", "  limit: 2");
    await publish(w, newer);
    expect((await start(token, held)).json.claim_id).toBeNull();
    expect(
      (await start(token, { ...held, policy_digest: digestOf(newer) })).json
        .claim_id,
    ).toBeNull();
    expect((await settle(token, held)).status).toBe(409);
  });

  test("records skew and reports the installation's current comparison", async () => {
    const { token, w } = await setup();
    const request = reservation();
    const before = await decision(token, request.call_fingerprint);
    await postJson(heartbeatRoute, "runtime/heartbeat", token, {
      policy_digest: request.policy_digest,
    });
    expect(await identity(token)).toMatchObject({ policy_skew: false });
    const running = reservation();
    expect((await reserve(token, running)).json.expires_at).toEqual(
      expect.any(String),
    );
    expect((await start(token, running)).json.claim_id).toEqual(
      expect.any(String),
    );
    const newer = POLICY.replace("  limit: 1", "  limit: 2");
    await publish(w, newer);
    expect(await identity(token)).toMatchObject({
      policy_digest: request.policy_digest,
      live_policy_digest: digestOf(newer),
      policy_skew: true,
    });
    expect((await reserve(token, request)).json).toMatchObject({
      expires_at: null,
      reason: expect.stringContaining("differs"),
    });
    expect((await start(token, running)).json.claim_id).toBeNull();
    expect(
      (await settle(token, running, { policy_digest: digestOf(newer) })).status,
    ).toBe(409);
    expect((await settle(token, running, { outcome: "success" })).status).toBe(
      200,
    );
    expect(
      (
        await reserve(token, {
          ...reservation(),
          policy_digest: digestOf(newer),
        })
      ).json.limits,
    ).toMatchObject([{ state: "ok", used: 1 }]);
    const after = await decision(token, randomUUID());
    const pulse = await postJson(heartbeatRoute, "runtime/heartbeat", token, {
      policy_digest: request.policy_digest,
    });
    expect(pulse).toEqual({ status: 200, json: { recorded: true } });
    const [installation] = await admin.query(
      "SELECT heartbeat_policy_skew FROM nodrail.installations WHERE workspace_id = $1 AND heartbeat_policy_digest = $2",
      [w.id, request.policy_digest],
    );
    expect(installation.heartbeat_policy_skew).toBe(true);
    const stored = await admin.query(
      "SELECT id, policy_skew FROM nodrail.action_requests WHERE id = ANY($1)",
      [[before, after]],
    );
    expect(stored).toEqual(
      expect.arrayContaining([
        { id: before, policy_skew: false },
        { id: after, policy_skew: true },
      ]),
    );
  });
});
