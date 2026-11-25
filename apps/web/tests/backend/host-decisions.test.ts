// Calls the hook decided on its host: recorded where Cloud's
// own decisions are, in their run's history and Activity, and never decided
// again: no permit or budget reservation comes from them. A host only
// allows or denies.
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, test } from "vitest";
import { POST as decisionsRoute } from "@/app/api/v1/runtime/decisions/route";
import { readWorkspace, withRuntime } from "@/server/db/context";
import { listActivity } from "@/server/modules/activity";
import { recordHostDecisions } from "@/server/modules/runtime/host-decisions";
import {
  getActionStatus,
  reportOutcome,
  requestPermit,
  submitAction,
} from "@/server/modules/runtime";
import { getRun, listRuns } from "@/server/modules/runs";
import { runEvents } from "@/server/modules/runs/history";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";
import { postJson } from "./reporting-world";
import { dispatch, ENV, rig, work } from "./runs-world";
import {
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  useDatabase,
  type TestWorkspace,
} from "./world";

useDatabase();

const DIGEST = "a".repeat(64);

const decision = (overrides: Record<string, unknown> = {}) => ({
  idempotency_key: `claude-code:${randomUUID()}`,
  tool: "files",
  operation: "file.write",
  resource: { kind: "file", id: "src/app.ts" },
  params: { path: "src/app.ts" },
  verdict: "allow",
  rule: { id: "edit-sources", name: "Edit sources" },
  reason: "Rule edit-sources allows files file.write.",
  decided_at: "2026-11-22T10:00:00.000Z",
  policy_digest: DIGEST,
  ...overrides,
});

const record = (token: string, decisions: unknown[]) =>
  withRuntime(token, "decisions:write", (context) =>
    recordHostDecisions(context, { decisions }),
  );

const idOf = (result: unknown) => {
  const found = result as { action_id?: string };
  if (!found.action_id)
    throw new Error(`Not recorded: ${JSON.stringify(result)}`);
  return found.action_id;
};

const count = async (sql: string, args: unknown[]) => {
  const [row]: { n: number }[] = await admin.query(sql, args);
  return row?.n ?? 0;
};

async function runOf(w: TestWorkspace, key: string) {
  const { runs } = await readWorkspace(w.owner, w.id, (context) =>
    listRuns(context, ENV),
  );
  const run = runs.find((found) => found.key === key);
  if (!run) throw new Error(`No run ${key}`);
  return run;
}

describe("host decisions", () => {
  test("a batch lands in its run, in order with Cloud's own decisions", async () => {
    const { w, token } = await rig();
    const key = "feat/host";
    await work(token, key, "dev", "done");
    const allowed = decision({ run: { key } });
    const denied = decision({
      verdict: "deny",
      tool: "shell",
      operation: "command.run",
      resource: { kind: "command", id: "rm -rf build" },
      params: { command: "rm -rf build" },
      rule: { id: "no-deletes" },
      run: { key },
    });
    const first = await record(token, [allowed, denied]);
    expect(first.results).toEqual([
      { key: allowed.idempotency_key, action_id: expect.any(String) },
      { key: denied.idempotency_key, action_id: expect.any(String) },
    ]);
    await dispatch(token, "helper", { key });

    const run = await runOf(w, key);
    const detail = await readWorkspace(w.owner, w.id, (context) =>
      getRun(context, ENV, run.id),
    );
    const actions = detail.timeline.flatMap((entry) =>
      entry.kind === "action" ? [entry.action] : [],
    );
    expect(
      actions.map((action) => [
        action.operationKey,
        action.evaluation,
        action.host,
      ]),
    ).toEqual([
      ["file.write", "ready", { policyDigest: DIGEST, policySkew: true }],
      ["command.run", "denied", { policyDigest: DIGEST, policySkew: true }],
      ["agent", "ready", undefined],
    ]);
    expect(detail.timeline.map((entry) => entry.kind)).toEqual([
      "started",
      "finished",
      "action",
      "action",
      "action",
    ]);

    // The history decisions read: the host's allowed write is a change.
    const events = await readWorkspace(w.owner, w.id, (context) =>
      runEvents(context, run.id),
    );
    expect(
      events.flatMap((event) =>
        event.type === "action"
          ? [[event.operation, event.outcome, event.change]]
          : [],
      ),
    ).toEqual([
      ["file.write", "allow", true],
      ["command.run", "deny", false],
      ["agent", "allow", false],
    ]);

    const activity = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { run: run.id }),
    );
    const hosted = activity.items.filter((item) => item.host);
    expect(hosted.map((item) => item.code).sort()).toEqual([
      "allowed_by_rule",
      "denied_by_rule",
    ]);
    expect(hosted.every((item) => item.host?.policyDigest === DIGEST)).toBe(
      true,
    );
  });

  test("a host's allowed change reopens a gate Cloud decides next", async () => {
    const { token } = await rig();
    const key = "feat/reopen";
    await work(token, key, "dev", "done");
    await work(token, key, "qa", "pass");
    await work(token, key, "reviewer", "ship");
    expect((await dispatch(token, "github", { key })).code).toBe("READY");
    await record(token, [decision({ run: { key } })]);
    expect(await dispatch(token, "github", { key })).toMatchObject({
      code: "DENIED",
      reason: "gate",
    });
  });

  test("a host only allows or denies: require_approval is refused, item by item", async () => {
    const { w, token } = await rig();
    const asked = decision({ verdict: "require_approval" });
    const kept = decision();
    const { results } = await record(token, [asked, kept]);
    expect(results).toEqual([
      { key: asked.idempotency_key, error: { code: "INVALID_INPUT" } },
      { key: kept.idempotency_key, action_id: expect.any(String) },
    ]);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM nodrail.action_requests
         WHERE workspace_id = $1 AND idempotency_key = $2`,
        [w.id, asked.idempotency_key],
      ),
    ).toBe(0);
  });

  test("Cloud opens no permit or reservation, and never permits one", async () => {
    const { w, token } = await rig();
    const [allowed, denied] = (
      await record(token, [decision(), decision({ verdict: "deny" })])
    ).results.map(idOf);
    const ids = [allowed, denied];
    for (const table of ["decision_permits", "budget_reservations"])
      expect(
        await count(
          `SELECT count(*)::int AS n FROM nodrail.${table}
           WHERE workspace_id = $1 AND action_request_id = ANY($2)`,
          [w.id, ids],
        ),
      ).toBe(0);
    const status = await withRuntime(token, "actions:read-own", (context) =>
      getActionStatus(context, allowed!),
    );
    await expect(
      withRuntime(token, "permits:request", (context) =>
        requestPermit(context, allowed!, {
          action_digest: status.action_digest,
          nonce: randomBytes(16).toString("hex"),
        }),
      ),
    ).rejects.toMatchObject({ code: "DECIDED_ON_HOST" });
  });

  test("a retry is the same row; another payload under the key is refused", async () => {
    const { token } = await rig();
    const item = decision();
    const first = await record(token, [item]);
    const again = await record(token, [item, item]);
    expect(again.results).toEqual([first.results[0], first.results[0]]);
    const changed = await record(token, [{ ...item, verdict: "deny" }]);
    expect(changed.results).toEqual([
      { key: item.idempotency_key, error: { code: "IDEMPOTENCY_CONFLICT" } },
    ]);
    // A key Cloud decided for is another request too, both ways.
    const submitted = randomUUID();
    await withRuntime(token, "actions:submit", (context) =>
      submitAction(context, submitted, {
        tool: "files",
        operation: "file.write",
        resource: { kind: "file", id: "src/app.ts" },
        params: { path: "src/app.ts" },
      }),
    );
    expect(
      (await record(token, [decision({ idempotency_key: submitted })])).results,
    ).toEqual([{ key: submitted, error: { code: "IDEMPOTENCY_CONFLICT" } }]);
    await expect(
      withRuntime(token, "actions:submit", (context) =>
        submitAction(context, item.idempotency_key, {
          tool: item.tool,
          operation: item.operation,
          resource: item.resource,
          params: item.params,
        }),
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  test("over HTTP: 409 per item, a bad item alone, and the scope", async () => {
    const { token } = await rig();
    const item = decision();
    const sent = await postJson(decisionsRoute, "runtime/decisions", token, {
      decisions: [item, { idempotency_key: "bad", verdict: "maybe" }],
    });
    expect(sent.status).toBe(200);
    expect(sent.json.results).toEqual([
      { key: item.idempotency_key, action_id: expect.any(String) },
      { key: "bad", error: { code: "INVALID_INPUT" } },
    ]);
    await admin.query(
      `UPDATE nodrail.installation_credentials
       SET scopes = array_remove(scopes, 'decisions:write')
       WHERE public_prefix = $1`,
      [token.split("_")[1]],
    );
    const refused = await postJson(decisionsRoute, "runtime/decisions", token, {
      decisions: [decision()],
    });
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("FORBIDDEN");
  });

  test("limits: batch size, body size, rate", async () => {
    const { w, token } = await rig();
    const tooMany = await postJson(decisionsRoute, "runtime/decisions", token, {
      decisions: Array.from({ length: 101 }, () => decision()),
    });
    expect(tooMany.status).toBe(422);
    const tooBig = await postJson(decisionsRoute, "runtime/decisions", token, {
      decisions: [decision({ params: { text: "x".repeat(70_000) } })],
    });
    // Refused before parsing, as every runtime body over 64 KB is.
    expect(tooBig.status).toBe(422);
    const bigParams = await record(token, [
      decision({ params: { text: "x".repeat(33_000) } }),
    ]);
    expect(bigParams.results[0]).toMatchObject({
      error: { code: "INVALID_INPUT" },
    });
    const [installation]: { id: string }[] = await admin.query(
      `SELECT installation_id AS id FROM nodrail.installation_credentials
       WHERE public_prefix = $1`,
      [token.split("_")[1]],
    );
    await admin.query(
      `UPDATE nodrail.runtime_rate_windows
       SET calls = 600, window_start = date_trunc('minute', clock_timestamp())
       WHERE installation_id = $1`,
      [installation!.id],
    );
    const limited = await postJson(decisionsRoute, "runtime/decisions", token, {
      decisions: [decision()],
    });
    expect(limited.status).toBe(429);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM nodrail.action_requests
         WHERE workspace_id = $1 AND decided_by = 'host'`,
        [w.id],
      ),
    ).toBe(0);
  });

  test("an outcome report on a host's row is recorded and settles nothing", async () => {
    const { w, token } = await rig();
    const id = idOf((await record(token, [decision()])).results[0]);
    await expect(
      withRuntime(token, "reports:write-own", (context) =>
        reportOutcome(context, id, {
          report_key: `${id}:outcome`,
          outcome: "success",
        }),
      ),
    ).resolves.toEqual({ recorded: true });
    const activity = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { q: id }),
    );
    // What the host allowed ran: not a report that goes around Nodrail.
    expect(activity.items[0]?.latestReport).toMatchObject({
      outcome: "success",
      mismatch: false,
    });
  });

  test("a host's row keeps what it said, and Cloud's rows say nothing of hosts", async () => {
    const { w, token } = await rig();
    const id = idOf((await record(token, [decision()])).results[0]);
    const [row] = await admin.query(
      `SELECT decided_by, policy_digest, host_rule_id, host_rule_name,
              host_reason, host_decided_at, body_digest, initial_evaluation
       FROM nodrail.action_requests WHERE id = $1`,
      [id],
    );
    expect(row).toMatchObject({
      decided_by: "host",
      policy_digest: DIGEST,
      host_rule_id: "edit-sources",
      host_rule_name: "Edit sources",
      initial_evaluation: "ready",
      body_digest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    await expect(
      admin.query(
        `UPDATE nodrail.action_requests SET policy_digest = $2 WHERE id = $1`,
        [id, "not-a-digest"],
      ),
    ).rejects.toThrow(/action_requests_policy_digest/);
    await expect(
      admin.query(
        `UPDATE nodrail.action_requests SET decided_by = 'server' WHERE id = $1`,
        [id],
      ),
    ).rejects.toThrow(/action_requests_host/);
    const server = await dispatch(token, "helper");
    const [cloud] = await admin.query(
      `SELECT decided_by, policy_digest FROM nodrail.action_requests WHERE id = $1`,
      [server.action_id],
    );
    expect(cloud).toEqual({ decided_by: "server", policy_digest: null });
    expect(
      await count(
        `SELECT count(*)::int AS n FROM nodrail.action_requests
         WHERE workspace_id = $1`,
        [w.id],
      ),
    ).toBeGreaterThan(1);
  });

  test("the app role can't rewrite a host's words; retention clears them", async () => {
    const [grants] = await admin.query(
      `SELECT has_column_privilege('nodrail_app', 'nodrail.action_requests', 'host_reason', 'UPDATE') AS app,
              has_column_privilege('nodrail_maintenance', 'nodrail.action_requests', 'host_reason', 'UPDATE') AS maintenance,
              has_column_privilege('nodrail_metrics', 'nodrail.action_requests', 'policy_digest', 'SELECT') AS metrics`,
    );
    expect(grants).toEqual({ app: false, maintenance: true, metrics: false });
  });

  test("a credential writes only into its own workspace, environment and runs", async () => {
    const { w, token } = await rig();
    const other = await createWorkspace();
    const otherToken = await issueToken(other, await createAgent(other, "bot"));
    const key = "feat/shared-name";
    await record(token, [decision({ run: { key } })]);
    // No run is published in `other`; its own run of the same name is its own.
    await record(otherToken, [decision({ run: { key } })]);
    const mine = await runOf(w, key);
    const detail = await readWorkspace(w.owner, w.id, (context) =>
      getRun(context, ENV, mine.id),
    );
    expect(detail.timeline).toHaveLength(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM nodrail.action_requests
         WHERE workspace_id = $1 AND decided_by = 'host'`,
        [other.id],
      ),
    ).toBe(1);
    // A step another installation recorded is not this one's to act in.
    const sibling = await issueToken(w, await createAgent(w, "sibling"));
    await work(token, "feat/step", "dev", "done");
    const run = await runOf(w, "feat/step");
    const [stepRow]: { step_key: string }[] = await admin.query(
      `SELECT step_key FROM nodrail.run_steps WHERE run_id = $1`,
      [run.id],
    );
    // The sibling's run of that name is its own: the step isn't in it.
    idOf(
      (
        await record(sibling, [
          decision({
            run: {
              key: "feat/step",
              step: { id: stepRow!.step_key, agent: "dev" },
            },
          }),
        ])
      ).results[0],
    );
    expect(
      await count(
        `SELECT count(*)::int AS n FROM nodrail.action_requests
         WHERE run_id = $1 AND decided_by = 'host'`,
        [run.id],
      ),
    ).toBe(0);
  });
});

describe("migration HostDecisions", () => {
  test(
    "goes down and up again; a host's row left behind can never get a permit",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_host_updown`,
        async (urls) => {
          const client = new Client({ connectionString: urls.admin });
          await client.connect();
          try {
            const [w, e, a, i] = Array.from({ length: 4 }, () => randomUUID());
            await client.query("SET session_replication_role = replica");
            await client.query(
              `INSERT INTO nodrail.action_requests
                 (id, workspace_id, installation_id, agent_id, environment_id,
                  idempotency_key, tool_key, operation_key, resource_kind,
                  resource_id, permission_fingerprint, descriptor_digest,
                  action_digest, initial_policy_version_id, access_epoch,
                  initial_evaluation, expires_at, decided_by, host_decided_at,
                  body_digest, policy_digest)
               VALUES ($1, $2, $3, $3, $4, 'k', 'files', 'file.write', 'file',
                       'a.ts', 'f', 'd', 'a', $3, 1, 'ready',
                       now() + interval '1 hour', 'host', now(), $5, $6)`,
              [a, w, i, e, `sha256:${"b".repeat(64)}`, DIGEST],
            );
            const columns = async () =>
              (
                await client.query(
                  `SELECT column_name FROM information_schema.columns
                   WHERE table_schema = 'nodrail'
                     AND table_name = 'action_requests'
                     AND column_name IN ('decided_by', 'policy_digest')
                   ORDER BY column_name`,
                )
              ).rows.map((row: { column_name: string }) => row.column_name);
            expect(await columns()).toEqual(["decided_by", "policy_digest"]);
            revertMigrationsThrough(urls.owner, "HostDecisions");
            expect(await columns()).toEqual([]);
            const [row] = (
              await client.query(
                `SELECT expires_at <= now() AS expired,
                        (SELECT relforcerowsecurity FROM pg_class
                         WHERE oid = 'nodrail.action_requests'::regclass) AS forced
                 FROM nodrail.action_requests WHERE id = $1`,
                [a],
              )
            ).rows;
            expect(row).toEqual({ expired: true, forced: true });
            runMigrations(urls.owner);
            expect(await columns()).toEqual(["decided_by", "policy_digest"]);
            const [after] = (
              await client.query(
                `SELECT decided_by FROM nodrail.action_requests WHERE id = $1`,
                [a],
              )
            ).rows;
            expect(after).toEqual({ decided_by: "server" });
          } finally {
            await client.end();
          }
        },
      ),
    120_000,
  );
});
