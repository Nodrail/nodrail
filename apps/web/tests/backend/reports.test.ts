import { describe, expect, test } from "vitest";
import type { ReportWindow } from "@/contracts/v1/reports";
import { readWorkspace } from "@/server/db/context";
import { getReport } from "@/server/modules/reports";
import { expectedReport, withoutIds } from "../support/report-fixture";
import { dispatch, ENV, publish, rig, step, work } from "./runs-world";
import {
  admin,
  createPerson,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

useDatabase();

const report = (w: TestWorkspace, days: ReportWindow = 30) =>
  readWorkspace(w.owner, w.id, (context) => getReport(context, ENV, days));

const expectCode = async (pending: Promise<{ code: string }>, code: string) =>
  expect((await pending).code).toBe(code);

/** The five runs of the fixture, driven through the API in order. */
async function seedFixture(w: TestWorkspace, token: string) {
  await work(token, "feat/a", "dev", "done", { usd: 1.5, tokens: 1000 });
  await work(token, "feat/a", "qa", "fail", { usd: 0.5, tokens: 200 });
  await expectCode(dispatch(token, "github", { key: "feat/a" }), "DENIED");
  await work(token, "feat/a", "dev", "done");
  await work(token, "feat/a", "qa", "pass");
  await work(token, "feat/a", "qa", "fail");
  await work(token, "feat/a", "dev", "done");
  await work(token, "feat/a", "qa", "pass");
  await work(token, "feat/a", "reviewer", "ship");
  await expectCode(dispatch(token, "github", { key: "feat/a" }), "READY");

  const b = { key: "feat/b", step: { id: "dev-b", agent: "dev" } };
  await work(token, b.key, "qa", "pass");
  await step(token, { run: { key: b.key }, step: b.step, event: "started" });
  await expectCode(dispatch(token, "helper", b), "READY");
  await expectCode(dispatch(token, "helper", b), "READY");
  await expectCode(dispatch(token, "helper", b), "DENIED");
  await step(token, { run: { key: b.key }, step: b.step, event: "finished" });
  // Deployed while qa's latest receipt is its pass: a later fail closes the
  // gate again (the latest receipt counts).
  await expectCode(dispatch(token, "deploy", { key: b.key }), "READY");
  await work(token, b.key, "qa", "fail");
  await expectCode(dispatch(token, "github", { key: b.key }), "DENIED");

  await work(token, "feat/c", "qa", "fail");
  await work(token, "feat/c", "dev", "done", { usd: 2, tokens: 3000 });
  await work(token, "feat/c", "qa", "PASS");
  await work(token, "feat/c", "reviewer", "ship_with_debt");
  await expectCode(dispatch(token, "github", { key: "feat/c" }), "READY");

  await expectCode(dispatch(token, "deploy", { key: "feat/d" }), "DENIED");
  await step(token, {
    run: { key: "feat/d" },
    step: { id: "infra-d", agent: "infra" },
    event: "started",
  });

  await expectCode(dispatch(token, "helper", { key: "feat/e" }), "READY");
}

const ageRun = (w: TestWorkspace, key: string, days: number) =>
  admin.query(
    `UPDATE nodrail.runs
     SET last_activity_at = clock_timestamp() - make_interval(days => $3)
     WHERE workspace_id = $1 AND key = $2`,
    [w.id, key, days],
  );

describe("reports through the database", () => {
  test("match the hand-counted fixture, by window", async () => {
    const { w, token } = await rig();
    await seedFixture(w, token);
    expect(withoutIds(await report(w))).toEqual(withoutIds(expectedReport));

    // A run last active ten days ago is in the 30-day window, not the 7-day one.
    await ageRun(w, "feat/e", 10);
    expect((await report(w, 30)).runs.count).toBe(5);
    expect((await report(w, 7)).runs).toMatchObject({
      count: 4,
      medianSteps: 3.5,
      withoutHold: { count: 1, of: 4 },
    });
    await ageRun(w, "feat/e", 100);
    expect((await report(w, 90)).runs.count).toBe(4);
  });

  test("an environment with no runs or gates reports nothing", async () => {
    const { w } = await workspaceWithToken();
    expect(await report(w)).toEqual({
      gates: [],
      budgets: [],
      agents: [],
      runs: {
        count: 0,
        medianSteps: null,
        withoutHold: { count: 0, of: 0 },
        reworkLoops: 0,
        withRework: 0,
        spend: { usd: 0, tokens: 0 },
      },
      checks: [],
      topRuns: [],
    });
  });

  test("reports read the rules live now", async () => {
    const { w, token } = await rig();
    await expectCode(dispatch(token, "deploy", { key: "feat/x" }), "DENIED");
    await publish(w, RULES_WITHOUT_GATES);
    const now = await report(w);
    expect(now.gates).toEqual([]);
    expect(now.runs).toMatchObject({ count: 1 });
  });

  test("another workspace's runs are not counted", async () => {
    const { w, token } = await rig();
    await expectCode(dispatch(token, "deploy", { key: "feat/x" }), "DENIED");
    const other = await rig();
    expect((await report(other.w)).runs.count).toBe(0);
    expect((await report(w)).runs.count).toBe(1);
  });

  test("a stranger cannot read a workspace's reports", async () => {
    const { w } = await rig();
    const stranger = await createPerson("Stranger");
    await expect(
      readWorkspace(stranger, w.id, (context) => getReport(context, ENV, 30)),
    ).rejects.toBeTruthy();
  });
});

const RULES_WITHOUT_GATES = `- required_engine_version: 3

- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow
`;
