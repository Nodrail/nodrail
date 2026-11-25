// Numeric budgets in Cloud: a version 4 policy
// published whole, reservations at the permit under action → run → window
// locks, settlement by the installation's report, reconciliation by an
// admin or policy manager, tenant isolation, unchanged older documents, and
// the migration going down and up on seeded data. Both deployment modes.
import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Client } from "pg";
import { describe, expect, test } from "vitest";
import type { ActionStatus } from "@nodrail/client/protocol";
import { compilePolicies } from "@nodrail/policy-engine/yaml";
import * as rulesRoute from "@/app/api/v1/rules/route";
import * as previewRoute from "@/app/api/v1/rules/preview/route";
import { VERSION_NOT_RENDERABLE_MESSAGE } from "@/contracts/v1/policies";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { createApiToken } from "@/server/modules/api-tokens";
import { policyFileForPage } from "@/server/modules/policies/file-page";
import { AuditEvent, PolicyVersion } from "@/server/db/entities";
import { reconcileReservation } from "@/server/modules/budgets/reconcile";
import { budgetStatus, listReservations } from "@/server/modules/budgets/read";
import {
  reportOutcome,
  requestPermit,
  submitAction,
} from "@/server/modules/runtime";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";
import { call, dispatch, ENV, publish, RULES, step } from "./runs-world";
import {
  addMember,
  admin,
  inEachMode,
  useDatabase,
  workspaceWithToken,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const ALLOW_PUBLISH = `- rule: Publish
  tool: outbox
  operation: publish
  resource: { kind: mcp_tool, match: any }
  effect: allow
`;

/** One publication a day for the whole environment. */
const DAILY = `- required_engine_version: 5
${ALLOW_PUBLISH}- budget: One publication a day
  id: daily
  count: { tool: outbox, operation: publish }
  limit: 1
  per: day
  timezone: UTC
  across: environment
  otherwise: deny
`;

const perRun = (
  limit: number,
  otherwise = "deny",
) => `- required_engine_version: 5
${ALLOW_PUBLISH}- budget: Publications per run
  id: publications
  count: { tool: outbox, operation: publish }
  limit: ${limit}
  per: run
  otherwise: ${otherwise}
`;

/** Several budgets on the same call, ids out of order, three scopes. */
const MIXED = `- required_engine_version: 5
${ALLOW_PUBLISH}- budget: Zeta per run
  id: zeta
  count: { tool: outbox, operation: publish }
  limit: 100
  per: run
  otherwise: deny
- budget: Alpha per day
  id: alpha
  count: { tool: outbox, operation: publish }
  limit: 100
  per: day
  timezone: Europe/Madrid
  across: environment
  otherwise: deny
- budget: Mu per step
  id: mu
  count: { tool: outbox, operation: publish }
  limit: 100
  per: step
  otherwise: deny
`;

const REFUNDS = `- required_engine_version: 5
- contracts:
    shapes:
      refund-args:
        properties:
          amount: { type: integer, min: 1, unit: usd_cents, report: true }
    connections:
      stripe:
        operations:
          refund: { input: refund-args }
- rule: Refunds
  tool: stripe
  operation: refund
  resource: { kind: mcp_tool, match: any }
  effect: allow
- budget: Refunds per run
  id: refund-total
  sum: { tool: stripe, operation: refund, path: input.amount }
  unit: usd_cents
  limit: 20000
  per: run
  otherwise: deny
`;

/** Subagent tokens as the host measures them; a call with no reading holds. */
const TOKENS = `- required_engine_version: 5
- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow
- budget: Subagent tokens
  id: subagent-tokens
  tokens: 100000
  source: measured
  per: run
  otherwise: deny
`;

/**
 * A rule file can't declare an operation's result (connections declare
 * results in nodrail.yaml), so the measured `result.` sum is put in the
 * stored version as a mediated connection's publish would leave it.
 */
async function measuredRefunds(w: TestWorkspace) {
  const id = randomUUID();
  await admin.query(
    `UPDATE nodrail.policy_versions
     SET run_policy = jsonb_set(run_policy, '{limits}', $2::jsonb)
     WHERE workspace_id = $1 AND run_policy ? 'limits'`,
    [
      w.id,
      JSON.stringify([
        {
          id,
          name: "Refunded per run, as measured",
          agent: null,
          measure: {
            kind: "sum",
            tool: "stripe",
            operation: "refund",
            path: "result.amount",
          },
          unit: "usd_cents",
          source: "measured",
          label: "measured-usage",
          limit: 1000,
          per: "run",
          timezone: null,
          across: "run",
          effect: "deny",
        },
      ]),
    ],
  );
}

const EVIDENCE = `- required_engine_version: 5
- contracts:
    shapes:
      ci-result:
        properties:
          status: { values: [passed, failed], report: true }
    evidence:
      ci-tests:
        shape: ci-result
        producers:
          - { class: externally-verified, verifier: github-actions }
        subject: revision
${ALLOW_PUBLISH}- gate: Tested before publishing
  id: tested
  tool: outbox
  operation: publish
  resource: { kind: mcp_tool, match: any }
  requires:
    - { evidence: ci-tests, authority: externally-verified, subject: revision, where: { status: passed } }
  otherwise: deny
- budget: Publications per run
  id: publications
  count: { tool: outbox, operation: publish }
  limit: 3
  per: run
  otherwise: deny
`;

type Run = { key: string; step?: { id: string; agent: string } };

const outbox = { tool: "outbox", operation: "publish" } as const;
const refund = { tool: "stripe", operation: "refund" } as const;

type Target = {
  tool: string;
  operation: string;
  resource?: { kind: string; id: string };
};

function submit(
  token: string,
  call_: Target,
  params: Record<string, unknown> = {},
  run?: Run & { subject?: string | null },
) {
  return call(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      resource: { kind: "mcp_tool", id: call_.tool },
      ...call_,
      params,
      ...(run ? { run } : {}),
    }),
  );
}

const permit = (token: string, action: ActionStatus, subject?: string | null) =>
  call(token, "permits:request", (context) =>
    requestPermit(context, action.action_id, {
      action_digest: action.action_digest,
      nonce: randomBytes(16).toString("hex"),
      ...(subject === undefined ? {} : { subject }),
    }),
  );

const report = (token: string, actionId: string, body: object) =>
  call(token, "reports:write-own", (context) =>
    reportOutcome(context, actionId, { report_key: randomUUID(), ...body }),
  );

/** Submitted and, when READY, asked for its permit: the permit's code. */
async function attempt(
  token: string,
  call_: Target = outbox,
  params: Record<string, unknown> = {},
  run?: Run,
) {
  const action = await submit(token, call_, params, run);
  if (action.code !== "READY") return { action, code: action.code };
  const answer = await permit(token, action);
  return {
    action,
    code: answer.code,
    reason: "reason" in answer ? answer.reason : null,
  };
}

const reservations = async (w: TestWorkspace) =>
  (await admin.query(
    `SELECT r.id, r.budget_key, r.state, r.amount::int AS amount,
            r.measured::int AS measured, r.settled_by, r.action_request_id
     FROM nodrail.budget_reservations r
     WHERE r.workspace_id = $1 ORDER BY r.created_at, r.id`,
    [w.id],
  )) as {
    id: string;
    budget_key: string;
    state: string;
    amount: number | null;
    measured: number | null;
    settled_by: string | null;
    action_request_id: string;
  }[];

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

async function rigWith(text: string) {
  const { w, token } = await workspaceWithToken();
  await publish(w, text);
  return { w, token };
}

const reconcile = (
  person: Person,
  w: TestWorkspace,
  id: string,
  body: object,
) =>
  withWorkspace(person, w.id, (context) =>
    reconcileReservation(context, ENV, id, body),
  );

const storedRunPolicy = async (w: TestWorkspace) => {
  const version = await admin.getRepository(PolicyVersion).findOneOrFail({
    where: { workspaceId: w.id },
    order: { revision: "DESC" },
  });
  return version.runPolicy as Record<string, unknown>;
};

const SUBJECT = `sha256:${"ab".repeat(32)}`;

inEachMode(() => {
  describe("publishing a version 4 policy", () => {
    test("keeps limits, gate evidence and evidence contracts whole", async () => {
      const { w } = await rigWith(EVIDENCE);
      const compiled = compilePolicies([
        { name: "rules.yaml", text: EVIDENCE },
      ]);
      if (!compiled.ok || compiled.document.version !== 4)
        throw new Error("expected a version 4 document");
      const stored = await storedRunPolicy(w);
      expect(Object.keys(stored).sort()).toEqual([
        "budgets",
        "evidence",
        "gates",
        "limits",
        "receipts",
      ]);
      expect(stored.evidence).toEqual(compiled.document.evidence);
      const [limit] = stored.limits as { id: string }[];
      const { id: _id, ...declared } = compiled.document.limits[0]!;
      expect(limit).toMatchObject(declared);
      const [gate] = stored.gates as { evidence: unknown }[];
      expect(gate?.evidence).toEqual(compiled.document.gates[0]?.evidence);
    });

    test("a changed limit is a change; the same file again is none", async () => {
      const { w } = await rigWith(perRun(3));
      const again = await publish(w, perRun(3));
      expect(again).toMatchObject({ added: 0, changed: 0, removed: 0 });
      const changed = await publish(w, perRun(4));
      expect(changed).toMatchObject({ changed: 1 });
      const [limit] = (await storedRunPolicy(w)).limits as { limit: number }[];
      expect(limit?.limit).toBe(4);
    });

    test("an evidence gate holds in Cloud until evidence is read here", async () => {
      const { token } = await rigWith(EVIDENCE);
      const held = await submit(token, outbox, {}, { key: "feat/e" });
      expect(held).toMatchObject({ code: "DENIED", reason: "gate" });
    });
  });

  describe("reserving at the permit", () => {
    test("50 parallel permits for one slot: exactly one goes ahead", async () => {
      const { w, token } = await rigWith(DAILY);
      const actions = await Promise.all(
        Array.from({ length: 50 }, () => submit(token, outbox)),
      );
      expect(actions.every((action) => action.code === "READY")).toBe(true);
      const answers = await Promise.all(
        actions.map((action) => permit(token, action)),
      );
      const allowed = answers.filter((answer) => answer.code === "ALLOW");
      expect(allowed).toHaveLength(1);
      expect(
        answers.filter(
          (answer) =>
            answer.code === "DENIED" &&
            "reason" in answer &&
            answer.reason === "budget",
        ),
      ).toHaveLength(49);
      const rows = await reservations(w);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        budget_key: expect.any(String),
        state: "reserved",
        amount: 1,
      });
      // The next one is refused at submit, and says why in declared numbers.
      const next = await submit(token, outbox);
      expect(next).toMatchObject({ code: "DENIED", reason: "budget" });
    });

    test("mixed budgets on the same calls never deadlock", async () => {
      const { w, token } = await rigWith(MIXED);
      const runs = ["feat/a", "feat/b", "feat/c"];
      const actions = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          submit(
            token,
            outbox,
            {},
            {
              key: runs[index % runs.length]!,
              step: { id: `s${index % 2}`, agent: "dev" },
            },
          ),
        ),
      );
      const answers = await Promise.all(
        actions.map((action) => permit(token, action)),
      );
      expect(answers.map((answer) => answer.code)).toEqual(
        Array(30).fill("ALLOW"),
      );
      const rows = await reservations(w);
      expect(rows).toHaveLength(90);
      expect(new Set(rows.map((row) => row.budget_key)).size).toBe(3);
    }, 60_000);

    test("a run budget counts each run apart, and a sum adds the input amount", async () => {
      const { token } = await rigWith(REFUNDS);
      const run = { key: "refunds/1" };
      expect(
        (await attempt(token, refund, { input: { amount: 15000 } }, run)).code,
      ).toBe("ALLOW");
      expect(
        await attempt(token, refund, { input: { amount: 6000 } }, run),
      ).toMatchObject({ code: "DENIED" });
      expect(
        (await attempt(token, refund, { input: { amount: 5000 } }, run)).code,
      ).toBe("ALLOW");
      // Another run has its own allowance.
      expect(
        (
          await attempt(
            token,
            refund,
            { input: { amount: 20000 } },
            { key: "refunds/2" },
          )
        ).code,
      ).toBe("ALLOW");
      // An amount that can't be read is unknown, and unknown holds.
      expect(
        await attempt(
          token,
          refund,
          { input: { amount: "[classified]" } },
          { key: "refunds/3" },
        ),
      ).toMatchObject({ code: "DENIED" });
      // A run budget with no run can't count, so it holds.
      expect(
        await attempt(token, refund, { input: { amount: 1 } }),
      ).toMatchObject({
        code: "DENIED",
      });
    });

    test("the subject the installation sends is kept with the action and its permit", async () => {
      const { w, token } = await rigWith(perRun(3));
      const action = await submit(
        token,
        outbox,
        {},
        { key: "feat/s", subject: SUBJECT },
      );
      expect(action.code).toBe("READY");
      expect((await permit(token, action, null)).code).toBe("ALLOW");
      const subjects = (actionId: string) =>
        admin.query(
          `SELECT stage, revision FROM nodrail.action_subjects
           WHERE workspace_id = $1 AND action_request_id = $2 ORDER BY stage`,
          [w.id, actionId],
        );
      // Null at the permit: the work couldn't be read then, which is unknown.
      expect(await subjects(action.action_id)).toEqual([
        { stage: "permit", revision: null },
        { stage: "submit", revision: "ab".repeat(32) },
      ]);
      // An older client sends nothing, and nothing is kept.
      const older = await submit(token, outbox, {}, { key: "feat/s" });
      expect((await permit(token, older)).code).toBe("ALLOW");
      expect(await subjects(older.action_id)).toEqual([]);
      await rejects(
        submit(token, outbox, {}, { key: "feat/s", subject: "abc" }),
        "INVALID_INPUT",
      );
    });
  });

  describe("settling with the report", () => {
    test("success consumes, failure releases, unknown is kept", async () => {
      const { w, token } = await rigWith(perRun(1));
      const run = { key: "feat/settle" };
      const failed = await attempt(token, outbox, {}, run);
      expect(failed.code).toBe("ALLOW");
      await report(token, failed.action.action_id, { outcome: "failure" });
      // A failure never counted: the slot is free again.
      const unknown = await attempt(token, outbox, {}, run);
      expect(unknown.code).toBe("ALLOW");
      await report(token, unknown.action.action_id, { outcome: "unknown" });
      expect(await attempt(token, outbox, {}, run)).toMatchObject({
        code: "DENIED",
      });
      // The first word stands: a later success doesn't change an unknown.
      await report(token, unknown.action.action_id, { outcome: "success" });
      expect((await reservations(w)).map((row) => row.state)).toEqual([
        "released",
        "unknown",
      ]);
      const other = { key: "feat/other" };
      const consumed = await attempt(token, outbox, {}, other);
      await report(token, consumed.action.action_id, { outcome: "success" });
      expect(await attempt(token, outbox, {}, other)).toMatchObject({
        code: "DENIED",
      });
      // No report at all keeps the reservation too: nothing expires.
      const silent = await attempt(token, outbox, {}, { key: "feat/silent" });
      expect(silent.code).toBe("ALLOW");
      await admin.query(
        `UPDATE nodrail.budget_reservations
         SET created_at = now() - interval '2 days',
             unknown_after = now() - interval '1 day'
         WHERE action_request_id = $1`,
        [silent.action.action_id],
      );
      expect(
        await attempt(token, outbox, {}, { key: "feat/silent" }),
      ).toMatchObject({ code: "DENIED" });
      // Oldest first: the silent one was moved two days back.
      const rows = await reservations(w);
      expect(rows.map((row) => [row.state, row.settled_by])).toEqual([
        ["reserved", null],
        ["released", "runtime"],
        ["unknown", "runtime"],
        ["consumed", "runtime"],
      ]);
    });

    test("a repeated report settles nothing twice", async () => {
      const { w, token } = await rigWith(perRun(2));
      const done = await attempt(token, outbox, {}, { key: "feat/r" });
      const body = { report_key: "same", outcome: "failure" };
      await report(token, done.action.action_id, body);
      await report(token, done.action.action_id, body);
      expect((await reservations(w)).map((row) => row.state)).toEqual([
        "released",
      ]);
    });
  });

  describe("agent-reported data never reaches a budget", () => {
    test("receipts, details and unreserved paths change no total", async () => {
      const { w, token } = await rigWith(perRun(1));
      const run = { key: "feat/agent" };
      const first = await attempt(token, outbox, {}, run);
      expect(first.code).toBe("ALLOW");
      // A step's receipt says it used nothing; details say the same.
      await step(token, {
        run: { key: run.key },
        step: { id: "dev-1", agent: "dev" },
        event: "started",
      });
      await step(token, {
        run: { key: run.key },
        step: { id: "dev-1", agent: "dev" },
        event: "finished",
        receipt: {
          verdict: "done",
          findings: [],
          usage: { tokens: 0, usd: 0 },
        },
      });
      await rejects(
        report(token, first.action.action_id, {
          outcome: "failure",
          measured: [{ path: "result.amount", value: 0 }],
        }),
        "INVALID_INPUT",
      );
      await report(token, first.action.action_id, {
        outcome: "unknown",
        details: { amount: 0, state: "released", budget: "publications" },
      });
      expect(await reservations(w)).toMatchObject([
        { state: "unknown", amount: 1 },
      ]);
      expect(await attempt(token, outbox, {}, run)).toMatchObject({
        code: "DENIED",
      });
    });

    test("measured tokens with no reading hold the next dispatch", async () => {
      const { w, token } = await rigWith(TOKENS);
      const agent = {
        tool: "claude-code",
        operation: "agent",
        resource: { kind: "agent", id: "helper" },
      };
      const run = { key: "feat/tokens" };
      const first = await attempt(token, agent, {}, run);
      expect(first.code).toBe("ALLOW");
      // The client reports only `result.` amounts: tokens are never read here.
      await rejects(
        report(token, first.action.action_id, {
          outcome: "success",
          measured: [{ path: "result.tokens", value: 0 }],
        }),
        "INVALID_INPUT",
      );
      await report(token, first.action.action_id, { outcome: "success" });
      expect(await attempt(token, agent, {}, run)).toMatchObject({
        code: "DENIED",
      });
      expect(await reservations(w)).toMatchObject([
        { state: "consumed", amount: null, measured: null },
      ]);
    });

    test("a measured budget takes only the reading it reserved, and no reading holds", async () => {
      const { w, token } = await rigWith(REFUNDS);
      await measuredRefunds(w);
      const run = { key: "refunds/m" };
      const read = await attempt(
        token,
        refund,
        { input: { amount: 600 } },
        run,
      );
      expect(read.code).toBe("ALLOW");
      await rejects(
        report(token, read.action.action_id, {
          outcome: "success",
          measured: [
            { path: "result.amount", value: 600 },
            { path: "result.other", value: 1 },
          ],
        }),
        "INVALID_INPUT",
      );
      await report(token, read.action.action_id, {
        outcome: "success",
        measured: [{ path: "result.amount", value: 600 }],
      });
      const unread = await attempt(
        token,
        refund,
        { input: { amount: 1 } },
        run,
      );
      expect(unread.code).toBe("ALLOW");
      await report(token, unread.action.action_id, { outcome: "success" });
      // Missing usage is unknown, never zero: the next call holds.
      expect(
        await attempt(token, refund, { input: { amount: 1 } }, run),
      ).toMatchObject({ code: "DENIED" });
      expect(await reservations(w)).toMatchObject([
        { state: "consumed", amount: null, measured: 600 },
        { state: "consumed", amount: null, measured: null },
      ]);
    });
  });

  describe("reconciling an unknown outcome", () => {
    async function unknownReservation() {
      const { w, token } = await rigWith(perRun(1));
      const done = await attempt(token, outbox, {}, { key: "feat/u" });
      await report(token, done.action.action_id, { outcome: "unknown" });
      const [row] = await reservations(w);
      return { w, token, id: row!.id, actionId: done.action.action_id };
    }

    test("an admin or policy manager settles it, and it is audited", async () => {
      const { w, token, id, actionId } = await unknownReservation();
      const manager = await addMember(w, "policy_manager");
      const settled = await reconcile(manager, w, id, {
        state: "released",
        note: "The provider has no such publication.",
      });
      expect(settled).toMatchObject({
        state: "released",
        shownAs: "released",
        settledBy: "person",
        note: "The provider has no such publication.",
      });
      const audit = await admin.getRepository(AuditEvent).findOneByOrFail({
        workspaceId: w.id,
        decisionCode: "budget_reconciled",
      });
      expect(audit).toMatchObject({
        actorUserId: manager.userId,
        actionRequestId: actionId,
        eventType: "budget.reconciled",
      });
      // Released: the slot is free again.
      expect((await attempt(token, outbox, {}, { key: "feat/u" })).code).toBe(
        "ALLOW",
      );
      // Settled once: a second word is refused.
      await rejects(
        reconcile(w.owner, w, id, { state: "consumed", note: "again" }),
        "DECISION_CONFLICT",
      );
    });

    test("any other role is refused, and a known outcome isn't re-decided", async () => {
      const { w, id } = await unknownReservation();
      for (const role of ["viewer"] as const) {
        const person = await addMember(w, role);
        await rejects(
          reconcile(person, w, id, { state: "released", note: "n" }),
          "FORBIDDEN",
        );
      }
      expect((await reservations(w))[0]?.state).toBe("unknown");
      await rejects(
        reconcile(w.owner, w, id, {
          state: "consumed",
          note: "n",
          measured: 3,
        }),
        "INVALID_INPUT",
      );
      await reconcile(w.owner, w, id, { state: "consumed", note: "It ran." });
      await rejects(
        reconcile(w.owner, w, id, { state: "released", note: "n" }),
        "DECISION_CONFLICT",
      );
    });

    test("a fresh reservation still waiting for its report can't be reconciled", async () => {
      const { w, token } = await rigWith(perRun(1));
      await attempt(token, outbox, {}, { key: "feat/f" });
      const [row] = await reservations(w);
      await rejects(
        reconcile(w.owner, w, row!.id, { state: "released", note: "n" }),
        "DECISION_CONFLICT",
      );
    });

    test("status lists it as unknown, to admins and policy managers only", async () => {
      const { w, id } = await unknownReservation();
      const status = await readWorkspace(w.owner, w.id, (context) =>
        budgetStatus(context, ENV),
      );
      expect(status.limits).toMatchObject([
        {
          label: "enforced-allowance",
          labelText: "Enforced allowance",
          limit: 1,
        },
      ]);
      expect(status.windows).toMatchObject([{ per: "run", unknown: 1 }]);
      expect(status.unknown.map((row) => row.id)).toEqual([id]);
      const viewer = await addMember(w, "viewer");
      const seen = await readWorkspace(viewer, w.id, (context) =>
        budgetStatus(context, ENV),
      );
      expect(seen).toMatchObject({ windows: [], unknown: [] });
    });
  });

  describe("tenant isolation", () => {
    test("another workspace sees, counts and settles none of it", async () => {
      const a = await rigWith(DAILY);
      const b = await rigWith(DAILY);
      expect((await attempt(a.token)).code).toBe("ALLOW");
      // The same budget id elsewhere is its own budget.
      expect((await attempt(b.token)).code).toBe("ALLOW");
      const [mine] = await reservations(a.w);
      await rejects(
        reconcile(b.w.owner, b.w, mine!.id, { state: "released", note: "n" }),
        "NOT_FOUND",
      );
      const listed = await readWorkspace(b.w.owner, b.w.id, (context) =>
        listReservations(context, ENV),
      );
      expect(listed.map((row) => row.id)).not.toContain(mine!.id);
      const counted = await withWorkspace(b.w.owner, b.w.id, (context) =>
        context.manager.query(
          `SELECT
             (SELECT count(*)::int FROM nodrail.budget_reservations) AS reservations,
             (SELECT count(*)::int FROM nodrail.budget_windows) AS windows`,
        ),
      );
      expect(counted).toEqual([{ reservations: 1, windows: 1 }]);
      // A row can't be written into another workspace either.
      await expect(
        withWorkspace(b.w.owner, b.w.id, (context) =>
          context.manager.query(
            `INSERT INTO nodrail.budget_windows
               (workspace_id, environment_id, budget_key, window_key, per,
                across, run_key, unit)
             VALUES ($1, $2, 'x', 'run-key:x', 'run', 'environment', 'x',
                     'calls')`,
            [a.w.id, a.w.environmentId],
          ),
        ),
      ).rejects.toThrow(/row-level security/);
      const [{ n }] = await admin.query(
        "SELECT count(*)::int AS n FROM nodrail.budget_windows WHERE workspace_id = $1",
        [a.w.id],
      );
      expect(n).toBe(1);
    });
  });

  describe("reading back a version 4 policy", () => {
    /** A route handler called as Next calls it, with a person's token. */
    async function api(
      handler: (
        request: NextRequest,
        segment: { params: Promise<object> },
      ) => Promise<Response>,
      token: string,
      body?: object,
    ) {
      const request = new NextRequest("http://localhost/api/v1/rules", {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const response = await handler(request, { params: Promise.resolve({}) });
      return {
        status: response.status,
        // oxlint-disable-next-line typescript/no-explicit-any -- checked by shape
        json: (await response.json()) as any,
      };
    }

    const tokenFor = async (w: TestWorkspace) =>
      (
        await withWorkspace(w.owner, w.id, (context) =>
          createApiToken(context, {
            name: "rules",
            scopes: ["read", "rules:write"],
            expiresInDays: 30,
          }),
        )
      ).secret;

    test("GET /rules refuses it plainly (409), and pages show why", async () => {
      const { w } = await rigWith(perRun(3));
      const token = await tokenFor(w);
      const answer = await api(rulesRoute.GET, token);
      expect(answer.status).toBe(409);
      expect(answer.json.error).toMatchObject({
        code: "VERSION_NOT_RENDERABLE",
        message: VERSION_NOT_RENDERABLE_MESSAGE,
      });
      // The Edit as YAML page reads null and shows the same words.
      expect(
        await readWorkspace(w.owner, w.id, (context) =>
          policyFileForPage(context, ENV),
        ),
      ).toBeNull();
      // An earlier version still reads back as a file.
      await publish(w, RULES);
      const back = await api(rulesRoute.GET, token);
      expect(back.status).toBe(200);
      expect(back.json.yaml).toContain("Builder step");
    });

    test("preview warns at each evidence requirement that Cloud holds its gate", async () => {
      const { w } = await workspaceWithToken();
      const token = await tokenFor(w);
      const answer = await api(previewRoute.POST, token, { yaml: EVIDENCE });
      expect(answer.status).toBe(200);
      expect(answer.json.issues).toEqual([]);
      expect(answer.json.warnings).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            "Tested before publishing: requires evidence ci-tests, which Cloud doesn't check yet",
          ),
        }),
      ]);
      expect(answer.json.warnings[0].line).toBeGreaterThan(1);
      // Without evidence, no such warning.
      const plain = await api(previewRoute.POST, token, { yaml: perRun(3) });
      expect(plain.json.warnings).toEqual([]);
    });
  });

  describe("older documents are unchanged", () => {
    test("a version 2 policy stores and decides exactly as before", async () => {
      const { w, token } = await rigWith(RULES);
      const stored = await storedRunPolicy(w);
      expect(Object.keys(stored).sort()).toEqual(["budgets", "gates"]);
      expect(stored.budgets).toMatchObject([
        { name: "Builder step", metric: "tool_calls", limit: 2, per: "step" },
      ]);
      // The legacy step budget still allows two calls and denies the third.
      const run = { key: "feat/legacy", step: { id: "dev-1", agent: "dev" } };
      const legacy = () => dispatch(token, "helper", run);
      expect((await legacy()).code).toBe("READY");
      expect((await legacy()).code).toBe("READY");
      expect(await legacy()).toMatchObject({
        code: "DENIED",
        reason: "budget",
      });
      const [{ windows, rows }] = await admin.query(
        `SELECT
           (SELECT count(*)::int FROM nodrail.budget_windows WHERE workspace_id = $1) AS windows,
           (SELECT count(*)::int FROM nodrail.budget_reservations WHERE workspace_id = $1) AS rows`,
        [w.id],
      );
      expect({ windows, rows }).toEqual({ windows: 0, rows: 0 });
    });
  });
});

describe("migration", () => {
  test(
    "goes down and up again on seeded data",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_budgets_updown`,
        async (urls) => {
          const client = new Client({ connectionString: urls.admin });
          await client.connect();
          try {
            const [w, e, a, p, i] = Array.from({ length: 5 }, () =>
              randomUUID(),
            );
            const d = "c".repeat(64);
            await client.query("SET session_replication_role = replica");
            await client.query(
              `INSERT INTO nodrail.action_requests
                 (id, workspace_id, installation_id, agent_id, environment_id,
                  idempotency_key, tool_key, operation_key, resource_kind,
                  resource_id, permission_fingerprint, descriptor_digest,
                  action_digest, initial_policy_version_id, access_epoch,
                  initial_evaluation, expires_at)
               VALUES ($1, $2, $3, $3, $4, 'k', 'outbox', 'publish', 'mcp_tool',
                       'outbox', 'f', 'd', 'a', $3, 1, 'ready',
                       now() + interval '1 hour')`,
              [a, w, i, e],
            );
            await client.query(
              `INSERT INTO nodrail.decision_permits
                 (id, workspace_id, action_request_id, policy_version_id,
                  credential_id, expires_at, claim_nonce_digest)
               VALUES ($1, $2, $3, $4, $4, now() + interval '5 seconds', 'n')`,
              [p, w, a, i],
            );
            await client.query(
              `INSERT INTO nodrail.action_subjects
                 (workspace_id, action_request_id, stage, revision)
               VALUES ($1, $2, 'submit', $3), ($1, $2, 'permit', NULL)`,
              [w, a, d],
            );
            const [window] = (
              await client.query(
                `INSERT INTO nodrail.budget_windows
                   (workspace_id, environment_id, budget_key, window_key, per,
                    across, run_key, unit)
                 VALUES ($1, $2, 'daily', 'run-key:feat', 'run', 'environment',
                         'feat', 'calls')
                 RETURNING id`,
                [w, e],
              )
            ).rows;
            await client.query(
              `INSERT INTO nodrail.budget_reservations
                 (workspace_id, environment_id, action_request_id, permit_id,
                  window_id, budget_key, source, unit, amount, unknown_after)
               VALUES ($1, $2, $3, $4, $5, 'daily', 'admission', 'calls', 1,
                       now() + interval '10 minutes')`,
              [w, e, a, p, window.id],
            );
            const tables = async () =>
              (
                await client.query(
                  `SELECT relname, relrowsecurity AND relforcerowsecurity AS forced
                   FROM pg_class
                   WHERE relnamespace = 'nodrail'::regnamespace
                     AND relname IN ('budget_windows', 'budget_reservations',
                                     'action_subjects')
                   ORDER BY relname`,
                )
              ).rows;
            const count = async (table: string) =>
              (
                await client.query(
                  `SELECT count(*)::int AS n FROM nodrail.${table}`,
                )
              ).rows[0].n;
            const all = [
              { relname: "action_subjects", forced: true },
              { relname: "budget_reservations", forced: true },
              { relname: "budget_windows", forced: true },
            ];
            expect(await tables()).toEqual(all);
            const [lease] = (
              await client.query(
                `INSERT INTO nodrail.budget_leases
                 (workspace_id, installation_id, call_key, body_digest, policy_digest, claim_id)
               VALUES ($1, $2, 'host-call', 'request-digest', $3, gen_random_uuid())
               RETURNING id`,
                [w, i, "a".repeat(64)],
              )
            ).rows;
            const [hostReservation] = (
              await client.query(
                `INSERT INTO nodrail.budget_reservations
                 (workspace_id, environment_id, window_id, lease_id, budget_key,
                  source, unit, amount, unknown_after, started_at, state, settled_by, settled_at)
               VALUES ($1, $2, $3, $4, 'daily', 'admission', 'calls', 1,
                       now() + interval '5 minutes', now(), 'consumed', 'runtime', now())
               RETURNING id`,
                [w, e, window.id, lease.id],
              )
            ).rows;
            expect(() =>
              revertMigrationsThrough(urls.owner, "HostBudgetLeases"),
            ).toThrow(
              "Cannot roll back shared budgets while host accounting is still needed",
            );
            expect(
              (
                await client.query(
                  "SELECT state FROM nodrail.budget_reservations WHERE id = $1",
                  [hostReservation.id],
                )
              ).rows,
            ).toEqual([{ state: "consumed" }]);
            await client.query(
              "DELETE FROM nodrail.budget_reservations WHERE id = $1",
              [hostReservation.id],
            );
            runMigrations(urls.owner);
            revertMigrationsThrough(urls.owner, "BudgetLedger");
            expect(await tables()).toEqual([]);
            // What was there before stays as it was.
            expect(await count("action_requests")).toBe(1);
            expect(await count("decision_permits")).toBe(1);
            runMigrations(urls.owner);
            expect(await tables()).toEqual(all);
            expect(await count("budget_reservations")).toBe(0);
            expect(await count("action_subjects")).toBe(0);
          } finally {
            await client.end();
          }
        },
      ),
    120_000,
  );
});
