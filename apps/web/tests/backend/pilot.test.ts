import { describe, expect, test } from "vitest";
import { pilotReport, toMarkdown, type PilotRow } from "@/server/pilot/report";
import {
  admin,
  appDirect,
  createAgent,
  createWorkspace,
  retriedCallAndCheckIn,
  submitIssue,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

useDatabase();

const asMetrics = <T>(run: (query: (sql: string) => Promise<unknown[]>) => T) =>
  appDirect.transaction(async (manager) => {
    await manager.query("SET LOCAL ROLE nodrail_metrics");
    return run((sql) => manager.query(sql));
  });

async function rowFor(w: TestWorkspace): Promise<PilotRow> {
  const [{ slug }]: { slug: string }[] = await admin.query(
    `SELECT slug FROM nodrail.workspaces WHERE id = $1`,
    [w.id],
  );
  const rows = await asMetrics(pilotReport);
  const row = rows.find((item) => item.workspace === slug);
  if (!row) throw new Error("workspace missing from the report");
  return row;
}

const age = (w: TestWorkspace, days: number) =>
  admin.query(
    `UPDATE nodrail.workspaces
     SET created_at = created_at - make_interval(days => $2) WHERE id = $1`,
    [w.id, days],
  );

describe("the pilot report", () => {
  test("an empty workspace reports nothing as nothing", async () => {
    const w = await createWorkspace();
    expect(await rowFor(w)).toMatchObject({
      minutes_to_connect: null,
      minutes_to_first_decision: null,
      active_second_week: false,
      intents: 0,
      denied: 0,
    });
  });

  test("retries and check-ins do not count as usage", async () => {
    const { w, token } = await workspaceWithToken();
    await retriedCallAndCheckIn(token);
    // The world helper's own request, plus this one logical call.
    expect(await rowFor(w)).toMatchObject({ intents: 2, retries: 2 });
  });

  test("calls no rule covers count as denied", async () => {
    const { w, token } = await workspaceWithToken();
    await submitIssue(token);
    await submitIssue(token);
    await submitIssue(token);
    // The world helper's own denied request, plus these three.
    expect(await rowFor(w)).toMatchObject({ intents: 4, denied: 4 });
  });

  test("timings run from the workspace's creation", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    await age(w, 1);
    const row = await rowFor(w);
    expect(row.minutes_to_first_decision).toBeGreaterThanOrEqual(1440);
  });

  test("second-week use is only days 7 to 14", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    expect((await rowFor(w)).active_second_week).toBe(false);
    await age(w, 8);
    expect((await rowFor(w)).active_second_week).toBe(true);
    await age(w, 8);
    expect((await rowFor(w)).active_second_week).toBe(false);
  });

  test("an archived workspace is left out", async () => {
    const w = await createWorkspace();
    await admin.query(
      `UPDATE nodrail.workspaces SET archived_at = now() WHERE id = $1`,
      [w.id],
    );
    await expect(rowFor(w)).rejects.toThrow(/missing/);
  });

  test("the table marks missing figures", () => {
    const table = toMarkdown([
      {
        workspace: "acme",
        minutes_to_connect: null,
        minutes_to_first_decision: 2.5,
        active_second_week: true,
        intents: 3,
        retries: 0,
        denied: 1,
        emails_sent: 1,
        emails_failed: 0,
      },
    ]);
    expect(table.split("\n")).toHaveLength(3);
    expect(table).toContain("| acme | — | 2.5 | yes | 3 | 0 | 1 | 1 | 0 |");
  });
});

describe("the metrics role cannot read content", () => {
  test.each([
    "SELECT name FROM nodrail.workspaces",
    "SELECT resource_id FROM nodrail.action_requests",
    "SELECT params_safe FROM nodrail.action_requests",
    "SELECT tool_key FROM nodrail.action_requests",
    "SELECT payload_safe FROM nodrail.audit_events",
    "SELECT actor_user_id FROM nodrail.audit_events",
    "SELECT recipient_email FROM nodrail.notification_outbox",
    "SELECT payload_safe FROM nodrail.notification_outbox",
    "SELECT name FROM nodrail.installations",
    "SELECT * FROM nodrail.users",
    "SELECT * FROM nodrail.installation_credentials",
    "SELECT * FROM nodrail.workspace_invites",
    "SELECT * FROM nodrail.policy_rules",
    "UPDATE nodrail.workspaces SET slug = 'x'",
    "DELETE FROM nodrail.action_requests",
  ])("is refused: %s", async (sql) => {
    await expect(asMetrics((query) => query(sql))).rejects.toThrow(
      /permission denied/,
    );
  });
});
