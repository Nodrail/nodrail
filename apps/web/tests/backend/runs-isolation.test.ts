import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test } from "vitest";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { AuditEvent } from "@/server/db/entities";
import { listActivity } from "@/server/modules/activity";
import { createRule } from "@/server/modules/policies";
import { previewPolicyFile } from "@/server/modules/policies/rule-files";
import { requestPermit, submitAction } from "@/server/modules/runtime";
import type { ActionStatus } from "@nodrail/sdk/protocol";
import { getRun, listRuns } from "@/server/modules/runs";
import { recordStep } from "@/server/modules/runs/steps";
import {
  RULES,
  call,
  dispatch,
  ENV,
  publish,
  rig,
  step,
  work,
  type Run,
} from "./runs-world";
import {
  admin,
  createAgent,
  issueToken,
  ruleBody,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

useDatabase();

const permit = (token: string, action: ActionStatus) =>
  call(token, "permits:request", (context) =>
    requestPermit(context, action.action_id, {
      action_digest: action.action_digest,
      nonce: randomUUID().replaceAll("-", ""),
    }),
  );

/** A second installation, of another agent, in the same environment. */
async function secondToken(w: TestWorkspace) {
  return issueToken(
    w,
    await createAgent(w, `other-${randomUUID().slice(0, 6)}`),
  );
}

/** Whether the promise settles within the time, without waiting for it longer. */
const settlesWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);

/**
 * Runs one runtime call in a transaction left open until `release`, so a
 * second call can be made while the first still holds whatever it locked.
 */
function heldOpen(token: string, work: (context: never) => Promise<unknown>) {
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started = () => undefined as void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  const finished = call(token, "actions:submit", async (context) => {
    await work(context as never);
    started();
    await gate;
  });
  return { ready, release, finished };
}

const seqs = (workspaceId: string) =>
  admin.query(
    `SELECT 'finished' AS kind, s.agent, s.finished_seq AS seq
     FROM nodrail.run_steps s WHERE s.workspace_id = $1 AND s.finished_seq IS NOT NULL
     UNION ALL
     SELECT 'action', ar.resource_id, ar.run_seq
     FROM nodrail.action_requests ar
     WHERE ar.workspace_id = $1 AND ar.run_seq IS NOT NULL
     ORDER BY seq`,
    [workspaceId],
  ) as Promise<{ kind: string; agent: string }[]>;

describe("a run belongs to its installation", () => {
  test("another installation's steps never satisfy this run's gate", async () => {
    const { w, token } = await rig();
    const other = await secondToken(w);
    const key = "feat/shared-key";
    await work(token, key, "dev", "done");
    await work(other, key, "qa", "pass");
    await work(other, key, "reviewer", "ship");
    expect((await dispatch(token, "github", { key })).code).toBe("DENIED");
    // The other installation's own run, with no builder in it, is complete.
    expect((await dispatch(other, "github", { key })).code).toBe("READY");

    const { runs } = await readWorkspace(w.owner, w.id, (context) =>
      listRuns(context, ENV),
    );
    expect(
      runs.map((run) => [run.key, run.steps]).sort((a, b) => +a[1] - +b[1]),
    ).toEqual([
      [key, 1],
      [key, 2],
    ]);
    expect(new Set(runs.map((run) => run.installationName)).size).toBe(2);
  });

  test("another installation cannot finish or add to this run's steps", async () => {
    const { w, token } = await rig();
    const other = await secondToken(w);
    const run: Run = { key: "feat/steal", step: { id: "s1", agent: "dev" } };
    await step(token, {
      run: { key: run.key },
      step: run.step,
      event: "started",
    });
    await step(other, {
      run: { key: run.key },
      step: { id: "s1", agent: "dev" },
      event: "finished",
      receipt: { verdict: "done", findings: [], usage: {} },
    });
    const rows: { started_at: Date | null; finished_at: Date | null }[] =
      await admin.query(
        `SELECT s.started_at, s.finished_at FROM nodrail.run_steps s
         JOIN nodrail.runs r ON r.id = s.run_id
         JOIN nodrail.installations i ON i.id = r.installation_id
         WHERE s.workspace_id = $1 AND s.step_key = 's1'
         ORDER BY s.finished_at NULLS FIRST`,
        [w.id],
      );
    // Two steps, one per installation's run: this one is still running.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ finished_at: null });
    expect(rows[0]?.started_at).toBeInstanceOf(Date);
  });
});

describe("order within a run", () => {
  test("a submit waiting on the run sees the qa finish that held it", async () => {
    const { w, token } = await rig();
    const key = "feat/order-lock";
    await work(token, key, "dev", "done");
    await work(token, key, "reviewer", "ship");
    const qa = { id: "qa-1", agent: "qa" };
    await step(token, { run: { key }, step: qa, event: "started" });

    const finish = heldOpen(token, (context) =>
      recordStep(context, {
        run: { key },
        step: qa,
        event: "finished",
        receipt: { verdict: "pass", findings: [], usage: {} },
      }),
    );
    await finish.ready;
    const submit = dispatch(token, "github", { key });
    // The run is locked by the finish, so the submit waits for it.
    expect(await settlesWithin(submit, 300)).toBe(false);
    finish.release();
    await finish.finished;
    expect((await submit).code).toBe("READY");

    // Its place comes after the finish it waited for, though both read a clock.
    const order = await seqs(w.id);
    expect(order.slice(-2)).toEqual([
      { kind: "finished", agent: "qa", seq: expect.any(String) },
      { kind: "action", agent: "github", seq: expect.any(String) },
    ]);
    const { runs } = await readWorkspace(w.owner, w.id, (context) =>
      listRuns(context, ENV),
    );
    const detail = await readWorkspace(w.owner, w.id, (context) =>
      getRun(context, ENV, runs[0]?.id ?? ""),
    );
    expect(detail.timeline.map((entry) => entry.kind).slice(-2)).toEqual([
      "finished",
      "action",
    ]);
  });

  /**
   * A step finishing while a submit in its run is still open: whether the
   * finish settles before the submit commits, and then that it is recorded.
   */
  async function finishDuringSubmit(token: string, waitMs: number) {
    const run = { key: "feat/lock", step: { id: "s1", agent: "dev" } };
    await dispatch(token, "first", run);
    const submit = heldOpen(token, (context) =>
      submitAction(context, randomUUID(), {
        tool: "claude-code",
        operation: "agent",
        resource: { kind: "agent", id: "second" },
        params: { subagent_type: "second" },
        run,
      }),
    );
    await submit.ready;
    const finished = step(token, {
      run: { key: run.key },
      step: run.step,
      event: "finished",
    });
    const settled = await settlesWithin(finished, waitMs);
    submit.release();
    await submit.finished;
    await expect(finished).resolves.toEqual({ recorded: true });
    return settled;
  }

  test("without a run policy, a step doesn't wait for a submit in its run", async () => {
    const { token } = await workspaceWithToken();
    // Submits still queue on the workspace's usage counter; steps don't.
    expect(await finishDuringSubmit(token, 2000)).toBe(true);
  });

  test("with a run policy, the same step waits for the submit", async () => {
    const { token } = await rig();
    expect(await finishDuringSubmit(token, 300)).toBe(false);
  });
});

describe("a run too long to decide", () => {
  test("is refused with its own code", async () => {
    const { w, token } = await rig();
    const key = "feat/long";
    await work(token, key, "qa", "pass");
    await admin.query(
      `INSERT INTO nodrail.run_steps
         (workspace_id, run_id, step_key, agent, installation_id,
          started_at, started_seq, finished_at, finished_seq)
       SELECT r.workspace_id, r.id, 'bulk-' || n, 'dev', r.installation_id,
              now(), nextval('nodrail.run_events'),
              now(), nextval('nodrail.run_events')
       FROM nodrail.runs r, generate_series(1, 10000) n
       WHERE r.workspace_id = $1 AND r.key = $2`,
      [w.id, key],
    );
    await expect(dispatch(token, "github", { key })).rejects.toMatchObject({
      code: "RUN_TOO_LONG",
      status: 409,
    });
  });
});

describe("the operator's switch", () => {
  afterEach(() => {
    delete process.env.NODRAIL_RUN_POLICY_DISABLED;
  });

  test("decides every version on its rules alone", async () => {
    const { token } = await rig();
    expect((await dispatch(token, "deploy", { key: "k" })).code).toBe("DENIED");
    process.env.NODRAIL_RUN_POLICY_DISABLED = "1";
    expect((await dispatch(token, "deploy", { key: "k" })).code).toBe("READY");
    expect((await dispatch(token, "github")).code).toBe("READY");
  });
});

describe("what a run records about each action", () => {
  test("whether it changes anything, decided once when it is recorded", async () => {
    const { w, token } = await rig();
    const submit = (descriptor: object) =>
      call(token, "actions:submit", (context) =>
        submitAction(context, randomUUID(), {
          ...descriptor,
          run: { key: "feat/change" },
        }),
      );
    await submit({
      tool: "files",
      operation: "file.write",
      resource: { kind: "file", id: "/repo/a.ts" },
      params: { path: "/repo/a.ts" },
    });
    await submit({
      tool: "shell",
      operation: "command.run",
      resource: { kind: "command", id: "git status" },
      params: { command: "git status" },
    });
    await dispatch(token, "helper");
    const rows: { resource_id: string; run_change: boolean | null }[] =
      await admin.query(
        `SELECT resource_id, run_change FROM nodrail.action_requests
         WHERE workspace_id = $1 AND tool_key IN ('files', 'shell', 'claude-code')
         ORDER BY created_at`,
        [w.id],
      );
    expect(rows).toEqual([
      { resource_id: "/repo/a.ts", run_change: true },
      { resource_id: "git status", run_change: false },
      { resource_id: "helper", run_change: null },
    ]);
  });
});

describe("changes in a run", () => {
  const writeFile = (token: string, key: string) =>
    call(token, "actions:submit", (context) =>
      submitAction(context, randomUUID(), {
        tool: "files",
        operation: "file.write",
        resource: { kind: "file", id: "/repo/a.ts" },
        params: { path: "/repo/a.ts" },
        run: { key },
      }),
    );

  /** The write gets its permit, and the pull request's gate closes again. */
  async function goesAheadAndCloses(
    token: string,
    key: string,
    write: ActionStatus,
  ) {
    expect(await permit(token, write)).toMatchObject({ code: "ALLOW" });
    expect((await dispatch(token, "github", { key })).code).toBe("DENIED");
  }

  test("a change that went ahead closes a passed gate; one held back doesn't", async () => {
    const { w, token } = await rig();
    const key = "feat/changed";
    await work(token, key, "qa", "pass");
    await work(token, key, "reviewer", "ship");
    // No rule allows writing yet, so this one never went ahead.
    expect((await writeFile(token, key)).code).toBe("DENIED");
    expect((await dispatch(token, "github", { key })).code).toBe("READY");

    await publish(
      w,
      `${RULES}
- rule: Write files
  tool: files
  operation: file.write
  resource: { kind: file, match: any }
  effect: allow
`,
    );
    await goesAheadAndCloses(token, key, await writeFile(token, key));
  });
});

describe("budgets and intents without a run", () => {
  test("an intent with no run is held by a budget that covers it", async () => {
    const { w, token } = await workspaceWithToken();
    await publish(
      w,
      `${RULES}
- budget: Run limit
  per: run
  tool_calls: 100
`,
    );
    // As a 0.1 client sends it: no run at all.
    expect(await dispatch(token, "helper")).toMatchObject({
      code: "DENIED",
      reason: "budget",
    });
  });
});

describe("holds in the audit log and Activity", () => {
  test("a gate's denial names the gate", async () => {
    const { w, token } = await rig();
    const status = await dispatch(token, "deploy", { key: "feat/audit" });
    const event = await admin.getRepository(AuditEvent).findOneByOrFail({
      workspaceId: w.id,
      actionRequestId: status.action_id,
    });
    expect(event.payloadSafe).toMatchObject({
      hold: { kind: "gate", name: "QA before a deploy" },
    });
    const { items } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { q: "QA before" }),
    );
    expect(items.map((item) => item.rule)).toEqual([
      expect.objectContaining({ kind: "gate", name: "QA before a deploy" }),
    ]);
  });
});

describe("rules for the Agent tool as it used to be", () => {
  const oldAgentRule = ruleBody({
    toolKey: "claude-code",
    operationKey: "agent",
    resource: { kind: "tool", match: "exact", value: "Agent" },
  });

  test("are refused by the rule form's API", async () => {
    const { w } = await workspaceWithToken();
    await expect(
      withWorkspace(w.owner, w.id, (context) =>
        createRule(context, ENV, oldAgentRule),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("are named as an issue when a file is imported", async () => {
    const { w } = await workspaceWithToken();
    const preview = await withWorkspace(w.owner, w.id, (context) =>
      previewPolicyFile(
        context,
        ENV,
        `- rule: Old agents
  tool: claude-code
  operation: agent
  resource: { kind: tool, match: exact, value: Agent }
  effect: allow
`,
      ),
    );
    expect(preview.issues.map((issue) => issue.message).join("\n")).toMatch(
      /agent/i,
    );
  });
});
