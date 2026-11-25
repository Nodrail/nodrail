import { describe, expect, test } from "vitest";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { AuditEvent } from "@/server/db/entities";
import { listAgents, pauseAgent } from "@/server/modules/agents";
import {
  getOverviewState,
  getPlanUsage,
  getRecentDecisions,
  getToday,
} from "@/server/modules/overview";
import { listHeldRuns } from "@/server/modules/runs";
import { list } from "./activity-world";
import { ENV, runsWorkspace } from "./runs-world";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
  useDeployment,
} from "./world";

useDatabase();

const read = <T>(
  person: HumanPrincipal,
  w: TestWorkspace,
  run: (
    context: Parameters<typeof getOverviewState>[0],
    environment: string,
  ) => Promise<T>,
) => readWorkspace(person, w.id, (context) => run(context, ENV));

async function busyWorkspace() {
  const w = await createWorkspace();
  const viewer = await addMember(w, "viewer");
  const fresh = await createAgent(w, "fresh", [viewer]);
  const expired = await createAgent(w, "expired");
  await createAgent(w, "paused");
  await admin.query(
    `UPDATE nodrail.installations
     SET last_seen_at = now() - make_interval(mins => CASE id
           WHEN $1::uuid THEN 2 WHEN $2::uuid THEN 90 ELSE 5 END)
     WHERE workspace_id = $3`,
    [fresh.installationId, expired.installationId, w.id],
  );
  await withWorkspace(w.owner, w.id, (context) =>
    pauseAgent(context, "paused"),
  );
  return { w, viewer };
}

describe("overview state", () => {
  // The plan usage figures are Cloud's Free allowance.
  useDeployment("cloud");

  test("the figures are exact", async () => {
    const { w } = await busyWorkspace();
    expect(await read(w.owner, w, getOverviewState)).toEqual({
      checkedIn: true,
      agents: { connected: 3, reporting: 2, paused: 1 },
      anyDecision: true,
    });
  });

  test("they match the pages they link to, for each person", async () => {
    const { w, viewer } = await busyWorkspace();
    for (const person of [w.owner, viewer]) {
      const state = await read(person, w, getOverviewState);
      const agents = await read(person, w, listAgents);
      expect(state.agents).toEqual(agents.summary);
    }
    expect(await read(viewer, w, getOverviewState)).toMatchObject({
      agents: { connected: 1, reporting: 1, paused: 0 },
    });
  });

  test("setup is complete from the first check-in", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "a");
    expect((await read(w.owner, w, getOverviewState)).checkedIn).toBe(false);
    await admin.query(
      `UPDATE nodrail.installations SET last_seen_at = now() - interval '9 days'
       WHERE id = $1`,
      [agent.installationId],
    );
    expect((await read(w.owner, w, getOverviewState)).checkedIn).toBe(true);
  });

  test("an empty workspace is all zeroes", async () => {
    const w = await createWorkspace();
    expect(await read(w.owner, w, getOverviewState)).toEqual({
      checkedIn: false,
      agents: { connected: 0, reporting: 0, paused: 0 },
      anyDecision: false,
    });
    expect(await read(w.owner, w, getRecentDecisions)).toEqual([]);
    expect(await readWorkspace(w.owner, w.id, getPlanUsage)).toEqual({
      actions: { used: 0, limit: 1000, state: "ok" },
      steps: { used: 0, limit: 1000, state: "ok" },
    });
  });
});

describe("recent decisions", () => {
  test("are Activity's decisions, changes left out", async () => {
    const { w, viewer } = await busyWorkspace();
    for (const person of [w.owner, viewer]) {
      const recent = await read(person, w, getRecentDecisions);
      const decisions = await list(person, w, { kind: "decisions" });
      expect(recent).toEqual(decisions.items);
      expect(recent.every((item) => item.group === "decision")).toBe(true);
    }
    const mine = await read(viewer, w, getRecentDecisions);
    expect(new Set(mine.map((item) => item.agentKey))).toEqual(
      new Set(["fresh"]),
    );
  });
});

describe("today", () => {
  /** A decision recorded this many days and hours ago. */
  const recorded = (
    w: TestWorkspace,
    agent: TestAgent,
    decisionCode: string,
    hoursAgo: number,
    payloadSafe: object = {},
  ) =>
    admin.getRepository(AuditEvent).insert({
      workspaceId: w.id,
      eventType: "authorization.decided",
      actorKind: "system",
      decisionCode,
      agentId: agent.id,
      environmentId: w.environmentId,
      occurredAt: new Date(Date.now() - hoursAgo * 3_600_000),
      payloadSafe,
    });

  const hold = { hold: { kind: "gate", name: "QA before a deploy" } };

  /**
   * By hand. Each agent starts with a denied request and an allow by rule
   * now. Then bot's decisions below, one of them too old to count.
   */
  async function fixture() {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    const bot = await createAgent(w, "bot", [viewer]);
    await createAgent(w, "other");
    await recorded(w, bot, "denied_by_rule", 2);
    await recorded(w, bot, "denied_by_rule", 23, hold);
    await recorded(w, bot, "allowed_by_rule", 25);
    await recorded(w, bot, "allowed_by_rule", 3 * 24 + 1);
    await recorded(w, bot, "allowed_by_rule", 3 * 24 + 2);
    await recorded(w, bot, "denied_agent_paused", 6 * 24 + 1);
    await recorded(w, bot, "allowed_by_rule", 8 * 24);
    await recorded(w, bot, "rule_create", 1);
    return { w, viewer };
  }

  test("counts each outcome for 24 hours and each of the last 7 days", async () => {
    const { w } = await fixture();
    expect(await read(w.owner, w, getToday)).toEqual({
      allowed: { count: 2, days: [0, 0, 0, 2, 0, 1, 2] },
      denied: { count: 2, days: [1, 0, 0, 0, 0, 0, 2] },
      held: { count: 1, days: [0, 0, 0, 0, 0, 0, 1] },
    });
  });

  test("agrees with Activity filtered to the last 24 hours", async () => {
    const { w, viewer } = await fixture();
    for (const person of [w.owner, viewer]) {
      const today = await read(person, w, getToday);
      for (const outcome of ["allowed", "denied", "held"] as const) {
        const { items } = await list(person, w, { outcome, range: "24h" });
        expect(today[outcome].count).toBe(items.length);
      }
    }
  });

  test("a viewer counts only their agents", async () => {
    const { w, viewer } = await fixture();
    expect(await read(viewer, w, getToday)).toMatchObject({
      allowed: { count: 1 },
      denied: { count: 2 },
    });
  });
});

describe("held runs", () => {
  test("are runs a gate holds now, with what is missing", async () => {
    const { w } = await runsWorkspace();
    const held = await read(w.owner, w, (context, environment) =>
      listHeldRuns(context, environment, 5),
    );
    expect(held).toEqual([
      expect.objectContaining({ key: "feat/waiting", status: "held" }),
      expect.objectContaining({
        key: "feat/held",
        status: "held",
        holding: {
          kind: "gate",
          name: "QA before a deploy",
          missing: [expect.objectContaining({ agent: "qa" })],
        },
      }),
    ]);
    const viewer = await addMember(w, "viewer");
    expect(
      await read(viewer, w, (context, environment) =>
        listHeldRuns(context, environment, 5),
      ),
    ).toEqual([]);
  });
});
