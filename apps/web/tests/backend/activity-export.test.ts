import { describe, expect, test } from "vitest";
import { activityQuery } from "@/contracts/v1/activity-query";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import {
  exportActivity,
  recordActivityExport,
} from "@/server/modules/activity/export";
import { exportColumns, exportText } from "@/features/activity/export-file";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  seedAction,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
} from "./world";
import { assignedOne, ENV, list } from "./activity-world";

useDatabase();

/** A seeded action, denied, with its decision recorded as the runtime does. */
async function deniedAction(
  w: TestWorkspace,
  agent: TestAgent,
  overrides: Parameters<typeof seedAction>[3] = {},
) {
  const { actionId } = await admin.transaction((manager) =>
    seedAction(manager, w, agent, overrides),
  );
  await admin.query(
    `INSERT INTO nodrail.audit_events
       (workspace_id, event_type, actor_kind, decision_code, agent_id,
        action_request_id, environment_id)
     VALUES ($1, 'authorization.decided', 'runtime', 'denied_by_rule', $2, $3, $4)`,
    [w.id, agent.id, actionId, w.environmentId],
  );
}

const exported = (
  person: HumanPrincipal,
  w: TestWorkspace,
  query: object = {},
  limit?: number,
) =>
  readWorkspace(person, w.id, (context) =>
    exportActivity(context, ENV, query, limit),
  );

/** The export's CSV, split into rows of cells (no field here holds a comma). */
async function csvRows(person: HumanPrincipal, w: TestWorkspace, query = {}) {
  const found = await exported(person, w, query);
  const text = exportText("csv", found.items, { capped: false, limit: 10 });
  return text
    .trimEnd()
    .split("\r\n")
    .map((line) => line.split(","));
}

describe("the export", () => {
  test("has the list's events, in the list's order, with stable columns", async () => {
    const w = await createWorkspace();
    await createAgent(w, "support");
    const found = await exported(w.owner, w);
    const listed = await list(w.owner, w);
    expect(found.items).toEqual(listed.items);
    const [header, ...rows] = await csvRows(w.owner, w);
    expect(header).toEqual([...exportColumns]);
    expect(rows).toHaveLength(found.items.length);
    for (const row of rows) {
      expect(row).toHaveLength(exportColumns.length);
      expect(row[0]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    }
  });

  test("follows the filters and ignores the page the list was on", async () => {
    const w = await createWorkspace();
    await createAgent(w, "support");
    const billing = await createAgent(w, "billing");
    await deniedAction(w, billing);
    const found = await exported(w.owner, w, {
      agent: "billing",
      outcome: "denied",
      cursor: "not-read",
    });
    expect(found.items.map((item) => [item.agentKey, item.code])).toEqual([
      ["billing", "denied_by_rule"],
    ]);
    expect(found.query.cursor).toBeUndefined();
  });

  test("stops at the limit and says so", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "support");
    for (let index = 0; index < 3; index += 1) await deniedAction(w, agent);
    const capped = await exported(w.owner, w, {}, 2);
    expect(capped).toMatchObject({ capped: true });
    expect(capped.items).toHaveLength(2);
    const whole = await exported(w.owner, w, {}, 100);
    expect(whole.capped).toBe(false);
    expect(whole.items.slice(0, 2)).toEqual(capped.items);
  });

  test("an agent's resource cannot become a spreadsheet formula", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "support");
    await deniedAction(w, agent, { resourceId: '=HYPERLINK("x","y")' });
    const found = await exported(w.owner, w, { q: "HYPERLINK" });
    const text = exportText("csv", found.items, { capped: false, limit: 10 });
    expect(text).toContain(`"'=HYPERLINK(""x"",""y"")"`);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe("who exports what", () => {
  test.each(["viewer"] as const)(
    "a %s exports only assigned agents' events",
    async (role) => {
      const { w, person } = await assignedOne(role);
      const found = await exported(person, w);
      expect(found.items.length).toBeGreaterThan(0);
      expect(new Set(found.items.map((item) => item.agentKey))).toEqual(
        new Set(["mine"]),
      );
      expect((await exported(person, w, { agent: "theirs" })).items).toEqual(
        [],
      );
    },
  );

  test("an unassigned viewer exports nothing about any agent", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await createAgent(w, "theirs");
    const found = await exported(viewer, w);
    expect(found.items.filter((item) => item.agentKey)).toEqual([]);
  });
});

describe("the audit log", () => {
  const record = (person: HumanPrincipal, w: TestWorkspace, rows: number) =>
    withWorkspace(person, w.id, (context) =>
      recordActivityExport(context, {
        environmentId: w.environmentId,
        format: "csv",
        query: activityQuery.parse({ outcome: "denied", q: "deploy" }),
        rows,
        capped: false,
      }),
    );

  test("records who exported, with which filters and how many", async () => {
    const w = await createWorkspace();
    await record(w.owner, w, 12);
    const [row] = (await admin.query(
      `SELECT actor_kind, actor_user_id, event_type, payload_safe
       FROM nodrail.audit_events
       WHERE workspace_id = $1 AND decision_code = 'activity_exported'`,
      [w.id],
    )) as {
      actor_kind: string;
      actor_user_id: string;
      event_type: string;
      payload_safe: Record<string, unknown>;
    }[];
    expect(row).toMatchObject({
      actor_kind: "human",
      actor_user_id: w.owner.userId,
      event_type: "activity.exported",
      payload_safe: {
        format: "csv",
        rows: 12,
        capped: false,
        filters: { outcome: "denied", q: "deploy" },
      },
    });
  });

  test("shows in Activity to admins and to the person who exported", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    const other = await addMember(w, "viewer");
    await record(viewer, w, 0);
    const changes = (person: HumanPrincipal) =>
      list(person, w, { kind: "changes" });
    const [own] = (await changes(viewer)).items;
    expect(own).toMatchObject({
      code: "activity_exported",
      label: "Activity exported",
      subject: "Activity as CSV",
      detail: "0 events · outcome: denied, q: deploy",
    });
    expect((await changes(w.owner)).items.map((item) => item.code)).toContain(
      "activity_exported",
    );
    expect((await changes(other)).items).toEqual([]);
  });
});
