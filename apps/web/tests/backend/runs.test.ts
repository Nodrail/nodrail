import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { ActionStatus } from "@nodrail/sdk/protocol";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { AuditEvent, PolicyVersion } from "@/server/db/entities";
import { listActivity } from "@/server/modules/activity";
import { createRule } from "@/server/modules/policies";
import { requestPermit } from "@/server/modules/runtime";
import { getRun, listRuns } from "@/server/modules/runs";
import { call, dispatch, ENV, rig, step, work } from "./runs-world";
import { admin, ruleBody, useDatabase, type TestWorkspace } from "./world";

useDatabase();

/** dev, then qa and reviewer passing: the github dispatch is ready. */
async function reviewedDispatch(token: string, key: string) {
  await work(token, key, "dev", "done");
  await work(token, key, "qa", "pass");
  await work(token, key, "reviewer", "ship");
  const ready = await dispatch(token, "github", { key });
  expect(ready.code).toBe("READY");
  return ready;
}

const permit = (token: string, action: ActionStatus) =>
  call(token, "permits:request", (context) =>
    requestPermit(context, action.action_id, {
      action_digest: action.action_digest,
      nonce: randomBytes(16).toString("hex"),
    }),
  );

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

/** The run's actions as its timeline shows them, by id. */
const actionsOf = async (w: TestWorkspace, key: string) => {
  const detail = await readWorkspace(w.owner, w.id, async (context) => {
    const { runs } = await listRuns(context, ENV);
    const run = runs.find((item) => item.key === key);
    return getRun(context, ENV, run?.id ?? "");
  });
  return detail.timeline.flatMap((entry) =>
    entry.kind === "action" ? [entry.action] : [],
  );
};

describe("gates in Cloud", () => {
  test("an intent with no run leaves every gate it matches unmet", async () => {
    const { token } = await rig();
    expect((await dispatch(token, "helper")).code).toBe("READY");
    expect(await dispatch(token, "github")).toMatchObject({
      code: "DENIED",
      reason: "gate",
    });
    expect(await dispatch(token, "deploy")).toMatchObject({
      code: "DENIED",
      reason: "gate",
    });
  });

  test("a deny gate records its id as the matched rule", async () => {
    const { w, token } = await rig();
    const status = await dispatch(token, "deploy", { key: "feat/a" });
    const version = await admin
      .getRepository(PolicyVersion)
      .findOneByOrFail({ workspaceId: w.id, revision: 2 });
    const gate = (
      version.runPolicy as { gates: { id: string; name: string }[] }
    ).gates.find((item) => item.name === "QA before a deploy");
    const event = await admin.getRepository(AuditEvent).findOneByOrFail({
      workspaceId: w.id,
      actionRequestId: status.action_id,
    });
    expect(event).toMatchObject({
      decisionCode: "denied_by_rule",
      matchedLogicalRuleId: gate?.id,
    });
  });

  test("a review gate denies and shows what is missing, so the agent can meet it", async () => {
    const { w, token } = await rig();
    const key = "feat/review";
    await work(token, key, "dev", "done");
    await work(token, key, "qa", "pass");
    const status = await dispatch(token, "github", { key });
    expect(status).toMatchObject({ code: "DENIED", reason: "gate" });
    const held = (await actionsOf(w, key)).find(
      (action) => action.id === status.action_id,
    );
    expect(held).toMatchObject({
      evaluation: "denied",
      hold: {
        kind: "gate",
        name: "Review before the pull request",
        missing: [
          {
            agent: "reviewer",
            verdicts: ["ship", "ship_with_debt"],
            since: ["dev", "infra"],
          },
        ],
      },
    });
    expect(held?.hold?.explanation).toContain("reviewer with ship");
    // Every requirement as the run stood: qa met it, reviewer never reported.
    expect(held?.hold?.requirements).toEqual([
      {
        agent: "qa",
        verdicts: ["pass"],
        since: ["dev", "infra"],
        met: true,
        reported: { verdict: "pass", at: expect.any(String) as string },
      },
      {
        agent: "reviewer",
        verdicts: ["ship", "ship_with_debt"],
        since: ["dev", "infra"],
        met: false,
        reported: null,
      },
    ]);

    // Nothing waits for a person: the denied call never gets a permit, and
    // once the reviewer passes, the agent's retry is ready.
    expect(await permit(token, status)).toMatchObject({ code: "DENIED" });
    await work(token, key, "reviewer", "ship");
    expect((await dispatch(token, "github", { key })).code).toBe("READY");
  });

  test("Activity names the run an action was part of", async () => {
    const { w, token } = await rig();
    const key = "feat/linked";
    await dispatch(token, "deploy", { key });
    const { items: events } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, {}),
    );
    const runs = events.map((event) => event.action?.run?.key);
    expect(runs).toContain(key);
    const { runs: listed } = await readWorkspace(w.owner, w.id, (context) =>
      listRuns(context, ENV),
    );
    const run = events.find((event) => event.action?.run)?.action?.run;
    expect(listed.map((item) => item.id)).toContain(run?.id);
  });

  test("a requirement counts only after the last work of the agents in since", async () => {
    const { token } = await rig();
    const key = "feat/since";
    await work(token, key, "dev", "done");
    await work(token, key, "qa", "fail");
    const ready = await reviewedDispatch(token, key);
    expect(await permit(token, ready)).toMatchObject({ code: "ALLOW" });

    // An infra step is builder work too, so the reviews no longer count.
    await work(token, key, "infra", "done");
    expect((await dispatch(token, "github", { key })).code).toBe("DENIED");
  });

  test("a permit asked after a builder started again is refused", async () => {
    const { token } = await rig();
    const key = "feat/race";
    const ready = await reviewedDispatch(token, key);
    await step(token, {
      run: { key },
      step: { id: "dev-again", agent: "dev" },
      event: "started",
    });
    // The gate is unmet again, so the permit's decision denies it.
    expect(await permit(token, ready)).toMatchObject({
      code: "DENIED",
      reason: "gate",
    });
  });

  test("runs are kept apart by key", async () => {
    const { token } = await rig();
    await work(token, "one", "qa", "pass");
    await work(token, "one", "reviewer", "ship");
    expect((await dispatch(token, "github", { key: "two" })).code).toBe(
      "DENIED",
    );
    expect((await dispatch(token, "github", { key: "one" })).code).toBe(
      "READY",
    );
  });
});

describe("budgets in Cloud", () => {
  test("count the actions stored for the step, including the one decided", async () => {
    const { token } = await rig();
    const run = { key: "feat/budget", step: { id: "d1", agent: "dev" } };
    expect((await dispatch(token, "helper", run)).code).toBe("READY");
    expect((await dispatch(token, "helper", run)).code).toBe("READY");
    expect(await dispatch(token, "helper", run)).toMatchObject({
      code: "DENIED",
      reason: "budget",
    });
    // Another dev step starts with its own count; the main agent has none.
    const next = { ...run, step: { id: "d2", agent: "dev" } };
    expect((await dispatch(token, "helper", next)).code).toBe("READY");
    for (let index = 0; index < 3; index += 1)
      expect((await dispatch(token, "helper", { key: run.key })).code).toBe(
        "READY",
      );
  });

  test("a permit counts only the actions before its own", async () => {
    const { token } = await rig();
    const run = { key: "feat/order", step: { id: "d1", agent: "dev" } };
    const first = await dispatch(token, "helper", run);
    const second = await dispatch(token, "helper", run);
    await dispatch(token, "helper", run);
    expect(await permit(token, second)).toMatchObject({ code: "ALLOW" });
    expect(await permit(token, first)).toMatchObject({ code: "ALLOW" });
  });
});

describe("recording steps", () => {
  test("repeating an event changes nothing; a different finish is refused", async () => {
    const { w, token } = await rig();
    const body = {
      run: { key: "feat/steps" },
      step: { id: "q1", agent: "qa" },
      event: "finished",
      receipt: { verdict: "pass", findings: ["flaky"], usage: { tokens: 10 } },
    };
    await step(token, { ...body, event: "started", receipt: undefined });
    await step(token, { ...body, event: "started", receipt: undefined });
    await step(token, body);
    await expect(step(token, body)).resolves.toEqual({ recorded: true });
    await rejects(
      step(token, { ...body, receipt: { ...body.receipt, verdict: "fail" } }),
      "IDEMPOTENCY_CONFLICT",
    );

    const { runs } = await readWorkspace(w.owner, w.id, (context) =>
      listRuns(context, ENV),
    );
    expect(runs).toMatchObject([{ key: "feat/steps", steps: 1, actions: 0 }]);
    const detail = await readWorkspace(w.owner, w.id, (context) =>
      getRun(context, ENV, runs[0]?.id ?? ""),
    );
    expect(detail.timeline.map((entry) => entry.kind)).toEqual([
      "started",
      "finished",
    ]);
    expect(detail.timeline[1]).toMatchObject({
      step: { agent: "qa", verdict: "pass", findings: ["flaky"] },
    });
  });

  test("a receipt block is read by the server; one that isn't last counts as none", async () => {
    const { token } = await rig();
    const key = "feat/receipts";
    const finish = async (id: string, text: string) => {
      const qa = { run: { key }, step: { id, agent: "qa" } };
      await step(token, { ...qa, event: "started" });
      await step(token, { ...qa, event: "finished", receipt: { text } });
    };
    await finish("quoted", "```nodrail-receipt\nverdict: pass\n```\nthen more");
    await work(token, key, "reviewer", "ship");
    expect((await dispatch(token, "github", { key })).code).toBe("DENIED");
    await finish("real", "QA done.\n```nodrail-receipt\nverdict: PASS\n```");
    expect((await dispatch(token, "github", { key })).code).toBe("READY");
  });

  test("a step keeps the agent it was first recorded with", async () => {
    const { token } = await rig();
    const run = { key: "feat/agent", step: { id: "s1", agent: "dev" } };
    await dispatch(token, "helper", run);
    await rejects(
      step(token, {
        run: { key: run.key },
        step: { id: "s1", agent: "qa" },
        event: "started",
      }),
      "INVALID_INPUT",
    );
  });

  test.each([
    [{ run: { key: "" }, step: { id: "a", agent: "qa" }, event: "started" }],
    [{ run: { key: "k" }, step: { id: "a", agent: "QA" }, event: "started" }],
    [{ run: { key: "k" }, step: { id: "a", agent: "qa" }, event: "paused" }],
    [
      {
        run: { key: "k" },
        step: { id: "a", agent: "qa" },
        event: "started",
        receipt: { text: "x" },
      },
    ],
    [
      {
        run: { key: "k" },
        step: { id: "a", agent: "qa" },
        event: "finished",
        receipt: { text: "x".repeat(8193) },
      },
    ],
  ])("refuses a malformed step %#", async (body) => {
    const { token } = await rig();
    await rejects(step(token, body), "INVALID_INPUT");
  });
});

describe("publishing keeps gates", () => {
  test("editing one rule carries the version's gates and budgets", async () => {
    const { w, token } = await rig();
    await withWorkspace(w.owner, w.id, (context) =>
      createRule(context, ENV, ruleBody({ name: "Another" })),
    );
    expect((await dispatch(token, "github", { key: "x" })).code).toBe("DENIED");
  });

  test("a publish does not release an action a gate denied", async () => {
    const { w, token } = await rig();
    const held = await dispatch(token, "github", { key: "feat/held" });
    await withWorkspace(w.owner, w.id, (context) =>
      createRule(context, ENV, ruleBody({ name: "Unrelated" })),
    );
    expect(await permit(token, held)).toMatchObject({ code: "DENIED" });
  });
});

describe("a run's timeline links each action to its event", () => {
  test("each denial, and a permit once one is issued", async () => {
    const { w, token } = await rig();
    const key = "feat/events";
    const held = await dispatch(token, "github", { key });
    const denied = await dispatch(token, "deploy", { key });
    const ready = await dispatch(token, "helper", { key });
    expect([held.code, denied.code, ready.code]).toEqual([
      "DENIED",
      "DENIED",
      "READY",
    ]);
    const timeline = async () => {
      const detail = await readWorkspace(w.owner, w.id, async (context) => {
        const [run] = (await listRuns(context, ENV)).runs;
        return getRun(context, ENV, run?.id ?? "");
      });
      return new Map(
        detail.timeline.flatMap((entry) =>
          entry.kind === "action"
            ? [[entry.action.id, entry.action.eventId] as const]
            : [],
        ),
      );
    };
    const eventOf = async (action: ActionStatus) => {
      const [event]: { id: string }[] = await admin.query(
        `SELECT id FROM nodrail.audit_events WHERE action_request_id = $1
         ORDER BY occurred_at DESC LIMIT 1`,
        [action.action_id],
      );
      return event?.id;
    };
    const before = await timeline();
    expect(before.get(held.action_id)).toBe(await eventOf(held));
    expect(before.get(denied.action_id)).toBe(await eventOf(denied));
    // Allowed, but nothing recorded until the integration asks for its permit.
    expect(before.get(ready.action_id)).toBeNull();

    await permit(token, ready);
    expect((await timeline()).get(ready.action_id)).toBe(await eventOf(ready));
  });
});
