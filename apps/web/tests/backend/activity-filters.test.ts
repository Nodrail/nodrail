import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { AuditEvent } from "@/server/db/entities";
import { pauseAgent } from "@/server/modules/agents";
import { getRunSummary, listRuns } from "@/server/modules/runs";
import { assignedOne, codes, decided, list } from "./activity-world";
import { ENV, runsWorkspace } from "./runs-world";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
} from "./world";

useDatabase();

const runs = (person: HumanPrincipal, w: TestWorkspace, query: object = {}) =>
  readWorkspace(person, w.id, (context) => listRuns(context, ENV, query, 1));

/** Every page of a filtered list, following its cursor. */
async function allPages(
  person: HumanPrincipal,
  w: TestWorkspace,
  query: object,
) {
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list(person, w, { ...query, cursor }, 1);
    seen.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return seen;
}

/** Moves an agent's audit events back in time, as days passing would. */
const age = (agent: TestAgent, days: number) =>
  admin.query(
    `UPDATE nodrail.audit_events
     SET occurred_at = now() - make_interval(days => $2)
     WHERE agent_id = $1`,
    [agent.id, days],
  );

describe("decisions", () => {
  test("only what happened: nothing waits for a person", async () => {
    const w = await createWorkspace();
    await createAgent(w, "support");
    expect(await codes(w.owner, w, { kind: "decisions" })).toEqual([
      "allowed_by_rule",
    ]);
    // An outcome that no longer exists means no filter.
    expect(await codes(w.owner, w, { outcome: "waiting" })).toEqual([
      "allowed_by_rule",
    ]);
  });
});

describe("shared filters", () => {
  test("agent narrows to one agent's events", async () => {
    const w = await createWorkspace();
    await createAgent(w, "support");
    await createAgent(w, "billing");
    const { items } = await list(w.owner, w, { agent: "billing" });
    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.agentKey))).toEqual(
      new Set(["billing"]),
    );
    expect(await codes(w.owner, w, { agent: "nobody" })).toEqual([]);
  });

  test("each outcome finds its own events", async () => {
    const w = await createWorkspace();
    const denied = await createAgent(w, "denied");
    const unmatched = await createAgent(w, "unmatched");
    await decided(w, denied, "denied_by_rule");
    await decided(w, unmatched, "denied_no_rule");
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "denied"),
    );
    const keys = async (outcome: string) =>
      new Set(
        (await list(w.owner, w, { outcome })).items.map((item) => item.code),
      );
    expect(await keys("allowed")).toEqual(new Set(["allowed_by_rule"]));
    expect(await keys("denied")).toEqual(
      new Set(["denied_by_rule", "denied_no_rule"]),
    );
  });

  test("held finds what a gate or budget stopped, decided or not", async () => {
    const { w } = await runsWorkspace();
    const { items } = await list(w.owner, w, { outcome: "held" });
    expect(
      new Set(items.map((item) => `${item.code} ${item.action?.run?.key}`)),
    ).toEqual(
      new Set(["denied_by_rule feat/waiting", "denied_by_rule feat/held"]),
    );
    expect(items).toHaveLength(2);
  });

  test("run narrows to the actions in that run", async () => {
    const { w } = await runsWorkspace();
    const [held] = (await runs(w.owner, w, { q: "feat/held" })).runs;
    const { items } = await list(w.owner, w, { run: held?.id });
    expect(items.map((item) => item.action?.run?.key)).toEqual(["feat/held"]);
    expect(await codes(w.owner, w, { run: randomUUID() })).toEqual([]);
  });

  test("a run filter that is not a run is not a page", async () => {
    const w = await createWorkspace();
    await expect(list(w.owner, w, { run: "feat/held" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("a time range leaves out what is older", async () => {
    const w = await createWorkspace();
    const old = await createAgent(w, "old");
    await createAgent(w, "recent");
    await age(old, 10);
    const agents = async (range: string) =>
      new Set(
        (await list(w.owner, w, { range, kind: "decisions" })).items.map(
          (item) => item.agentKey,
        ),
      );
    expect(await agents("7d")).toEqual(new Set(["recent"]));
    expect(await agents("30d")).toEqual(new Set(["old", "recent"]));
    expect(await agents("all")).toEqual(new Set(["old", "recent"]));
  });

  test("filters combine, and pages of a filtered list cover it once", async () => {
    const w = await createWorkspace();
    for (const key of ["a", "b", "c"]) await createAgent(w, key);
    const other = await createAgent(w, "other");
    await age(other, 2);
    const query = { kind: "decisions", range: "24h" };
    const pages = await allPages(w.owner, w, query);
    const whole = (await list(w.owner, w, query)).items.map((item) => item.id);
    expect(pages).toEqual(whole);
    expect(pages).toHaveLength(3);
    expect(await allPages(w.owner, w, { ...query, agent: "b" })).toHaveLength(
      1,
    );
  });
});

describe("filters keep each person to what they may see", () => {
  test("a viewer filtering by another agent gets nothing", async () => {
    const { w, person } = await assignedOne("viewer");
    expect(await codes(person, w, { agent: "theirs" })).toEqual([]);
    expect(await codes(person, w, { outcome: "allowed" })).toHaveLength(1);
    const mine = await allPages(person, w, { agent: "mine" });
    expect(mine).toHaveLength(1);
  });

  test("a viewer's runs are only their agents' runs", async () => {
    const { w } = await runsWorkspace();
    const viewer = await addMember(w, "viewer");
    expect((await runs(viewer, w)).runs).toEqual([]);
    const [run] = (await runs(w.owner, w)).runs;
    await expect(
      readWorkspace(viewer, w.id, (context) =>
        getRunSummary(context, ENV, run?.id ?? ""),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the runs view", () => {
  const keys = async (w: TestWorkspace, query: object) => {
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await runs(w.owner, w, { ...query, cursor });
      found.push(...page.runs.map((run) => run.key));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return found.sort();
  };

  test("says what holds each run, and how it stands", async () => {
    const { w } = await runsWorkspace();
    const all = await readWorkspace(w.owner, w.id, (context) =>
      listRuns(context, ENV),
    );
    const byKey = new Map(all.runs.map((run) => [run.key, run]));
    expect(byKey.get("feat/held")).toMatchObject({
      status: "held",
      held: 1,
      agentKey: "bot",
      holding: { kind: "gate", name: "QA before a deploy" },
      agents: [{ agent: "dev", steps: 1, verdict: "done", finished: true }],
    });
    expect(byKey.get("feat/waiting")).toMatchObject({
      status: "held",
      holding: { kind: "gate", name: "Review before the pull request" },
    });
    expect(byKey.get("feat/quiet")).toMatchObject({
      status: "idle",
      holding: null,
      agents: [{ agent: "qa", verdict: "pass" }],
    });
  });

  test("the shared filters narrow runs, page by page", async () => {
    const { w } = await runsWorkspace();
    expect(await keys(w, {})).toEqual([
      "feat/held",
      "feat/quiet",
      "feat/waiting",
    ]);
    expect(await keys(w, { outcome: "held" })).toEqual([
      "feat/held",
      "feat/waiting",
    ]);
    expect(await keys(w, { outcome: "denied" })).toEqual([
      "feat/held",
      "feat/waiting",
    ]);
    expect(await keys(w, { q: "QUIET" })).toEqual(["feat/quiet"]);
    expect(await keys(w, { agent: "bot", range: "24h" })).toHaveLength(3);
    expect(await keys(w, { agent: "other" })).toEqual([]);
    await admin.query(
      `UPDATE nodrail.runs SET last_activity_at = now() - interval '3 days'
       WHERE workspace_id = $1 AND key = 'feat/quiet'`,
      [w.id],
    );
    expect(await keys(w, { range: "24h" })).toEqual([
      "feat/held",
      "feat/waiting",
    ]);
  });
});

describe("audit events are only recorded where they belong", () => {
  test("an export event is not an agent's event", async () => {
    const w = await createWorkspace();
    await createAgent(w, "support");
    await admin.getRepository(AuditEvent).insert({
      workspaceId: w.id,
      eventType: "activity.exported",
      actorKind: "human",
      actorUserId: w.owner.userId,
      decisionCode: "activity_exported",
      environmentId: w.environmentId,
    });
    expect(
      await codes(w.owner, w, { agent: "support", kind: "changes" }),
    ).toEqual([]);
    expect(await codes(w.owner, w, { kind: "changes" })).toEqual([
      "activity_exported",
    ]);
  });
});
