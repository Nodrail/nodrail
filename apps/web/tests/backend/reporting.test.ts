// Reporting contract v2 on the receiver (CW-03, CW-04): decisions and local
// run events are kept as evidence, once each, from the token's own
// workspace and person; nothing reported becomes a Cloud action
// or permit; local runs are put together from events in any order.
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { withWorkspace } from "@/server/db/context";
import {
  listLocalRuns,
  listReportedDecisions,
} from "@/server/modules/reporting/list";
import { removeMember } from "@/server/modules/team/members";
import * as reportedDecisions from "@/app/api/v1/reported/decisions/route";
import {
  json,
  MACHINE,
  observation,
  PROJECT_ID,
  reportingToken,
  send,
  span,
} from "./reporting-world";
import {
  addMember,
  admin,
  createWorkspace,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const decision = (outcome: string, extra: Record<string, string> = {}) =>
  span("nodrail.decision", {
    "nodrail.machine": MACHINE,
    "nodrail.host": "claude-code",
    "nodrail.agent": "marketing",
    "nodrail.decision": outcome,
    "nodrail.tool": "outbox",
    "nodrail.operation": "publish",
    "nodrail.resource.kind": "channel",
    "nodrail.rule": "marketing-never-publishes",
    "nodrail.policy.revision": "c".repeat(64),
    ...extra,
  });

const RUN = "e".repeat(32);
const runEvent = (
  type: string,
  extra: Record<string, string>,
  at = Date.now(),
) =>
  span(
    "nodrail.run.event",
    {
      "nodrail.machine": MACHINE,
      "nodrail.host": "codex",
      "nodrail.run": RUN,
      "nodrail.run.event": type,
      "nodrail.agent": "qa",
      ...extra,
    },
    at,
  );

const decisions = (w: TestWorkspace, person: Person) =>
  withWorkspace(person, w.id, (context) =>
    listReportedDecisions(context, "development"),
  );

const count = async (table: string, workspaceId: string) =>
  (
    (await admin.query(
      `SELECT count(*)::int AS count FROM nodrail.${table} WHERE workspace_id = $1`,
      [workspaceId],
    )) as { count: number }[]
  )[0]!.count;

describe("decisions reported by a local hook", () => {
  test.each(["otlp-http/protobuf", "otlp-http/json"] as const)(
    "kept with an observation in one %s export, as local evidence only",
    async (protocol) => {
      const w = await createWorkspace();
      const secret = await reportingToken(w, w.owner);
      const answer = await send(
        secret,
        [observation(), decision("deny"), decision("allow")],
        { protocol, projectId: PROJECT_ID },
      );
      expect(answer.status).toBe(200);
      if (protocol === "otlp-http/json") expect(json(answer.bytes)).toEqual({});
      else expect(answer.bytes.length).toBe(0);
      const kept = await decisions(w, w.owner);
      expect(kept.map((each) => each.decision).sort()).toEqual([
        "allow",
        "deny",
      ]);
      expect(kept[0]).toMatchObject({
        mine: true,
        project: "desk",
        projectBound: true,
        host: "claude-code",
        agent: "marketing",
        tool: "outbox",
        rule: "marketing-never-publishes",
        policyRevision: "c".repeat(64),
      });
      // Evidence, never Cloud state: no action or permit appears.
      for (const table of ["action_requests", "decision_permits"])
        expect(await count(table, w.id)).toBe(0);
    },
  );

  test("a retry with the same spans adds nothing", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const spans = [decision("deny"), decision("allow")];
    await send(secret, spans);
    await send(secret, spans);
    expect(await count("reported_events", w.id)).toBe(2);
  });

  test("a newer schema, an unknown kind or a malformed span is refused; the rest kept", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const mixed = await send(
      secret,
      [
        decision("deny"),
        span("nodrail.other", { "nodrail.host": "codex" }),
        decision("maybe"),
        decision("deny", { "nodrail.policy.revision": "/home/example" }),
      ],
      { protocol: "otlp-http/json" },
    );
    expect(json(mixed.bytes).partialSuccess.rejectedSpans).toBe("3");
    expect(await count("reported_events", w.id)).toBe(1);
    const newer = await send(secret, [decision("deny")], {
      protocol: "otlp-http/json",
      schema: "4",
    });
    expect(json(newer.bytes).partialSuccess.rejectedSpans).toBe("1");
  });

  test("a span can't choose its workspace or person", async () => {
    const w = await createWorkspace();
    const other = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    await send(secret, [
      decision("deny", {
        "nodrail.workspace": other.id,
        "enduser.id": other.owner.userId,
      }),
    ]);
    expect(await count("reported_events", other.id)).toBe(0);
    const [row] = (await admin.query(
      "SELECT workspace_id, user_id, details FROM nodrail.reported_events WHERE workspace_id = $1",
      [w.id],
    )) as { workspace_id: string; user_id: string; details: object }[];
    expect(row).toMatchObject({ workspace_id: w.id, user_id: w.owner.userId });
    expect(JSON.stringify(row!.details)).not.toContain(other.id);
  });

  test("viewers see their own; a reporting token reads nothing; leaving removes theirs", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await send(await reportingToken(w, w.owner), [decision("deny")]);
    const viewerToken = await reportingToken(w, viewer);
    await send(viewerToken, [decision("allow")]);
    expect((await decisions(w, w.owner)).length).toBe(2);
    expect((await decisions(w, viewer)).map((each) => each.decision)).toEqual([
      "allow",
    ]);
    const read = await reportedDecisions.GET(
      new NextRequest("http://localhost/api/v1/reported/decisions", {
        headers: { authorization: `Bearer ${viewerToken}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(read.status).toBe(403);
    await withWorkspace(w.owner, w.id, (context) =>
      removeMember(context, viewer.userId),
    );
    expect(await count("reported_events", w.id)).toBe(1);
  });
});

describe("local runs", () => {
  test("steps from events in any order; a duplicate adds nothing; unknowns stay unknown", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const t = Date.now() - 60_000;
    const finished = runEvent(
      "step.finished",
      {
        "nodrail.step": "s1",
        "nodrail.verdict": "pass",
        "nodrail.findings": "2",
        "nodrail.usage.tokens": "1200",
      },
      t + 3000,
    );
    // The finish arrives first, then the start; then the finish again.
    await send(secret, [finished]);
    await send(secret, [
      runEvent("step.started", { "nodrail.step": "s1" }, t),
      runEvent("step.started", { "nodrail.step": "s2" }, t + 1000),
      runEvent(
        "action",
        {
          "nodrail.tool": "github",
          "nodrail.operation": "pulls.merge",
          "nodrail.outcome": "deny",
          "nodrail.change": "false",
        },
        t + 2000,
      ),
    ]);
    await send(secret, [finished]);
    const [run] = await withWorkspace(w.owner, w.id, (context) =>
      listLocalRuns(context, "development"),
    );
    expect(run).toMatchObject({
      run: RUN,
      host: "codex",
      mine: true,
      actions: { allowed: 0, denied: 1, other: 0 },
    });
    expect(run!.steps).toEqual([
      {
        step: "s1",
        agent: "qa",
        startedAt: new Date(t).toISOString(),
        finishedAt: new Date(t + 3000).toISOString(),
        verdict: "pass",
        findings: 2,
        tokens: 1200,
        usd: null,
        receipt: null,
        receiptState: null,
        receiptContract: null,
        exchanges: [],
      },
      {
        step: "s2",
        agent: "qa",
        startedAt: new Date(t + 1000).toISOString(),
        finishedAt: null,
        verdict: null,
        findings: null,
        tokens: null,
        usd: null,
        receipt: null,
        receiptState: null,
        receiptContract: null,
        exchanges: [],
      },
    ]);
    // Never a Cloud run.
    expect(await count("runs", w.id)).toBe(0);
  });

  test("the same run key in two projects, or on two machines, is two runs", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const t = Date.now() - 60_000;
    const action = (outcome: string, machine = MACHINE) =>
      runEvent(
        "action",
        {
          "nodrail.machine": machine,
          "nodrail.tool": "github",
          "nodrail.operation": "pulls.create",
          "nodrail.outcome": outcome,
        },
        t,
      );
    await send(secret, [action("allow")], {
      project: "desk",
      projectId: PROJECT_ID,
    });
    await send(secret, [action("deny")], {
      project: "other",
      projectId: "0b6c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
    });
    await send(secret, [action("allow", "b".repeat(32))], {
      project: "desk",
      projectId: PROJECT_ID,
    });
    // Unbound: the name stands in for the id, apart from the bound "desk".
    await send(secret, [action("allow")], { project: "desk" });
    const runs = await withWorkspace(w.owner, w.id, (context) =>
      listLocalRuns(context, "development"),
    );
    expect(runs).toHaveLength(4);
    expect(new Set(runs.map((run) => run.id)).size).toBe(4);
    const byProjection = (a: unknown, b: unknown) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b));
    expect(
      runs
        .map((run) => [
          run.project,
          run.projectBound,
          run.machine?.[0],
          run.actions.allowed,
          run.actions.denied,
        ])
        .sort(byProjection),
    ).toEqual(
      [
        ["desk", true, "a", 1, 0],
        ["desk", true, "b", 1, 0],
        ["desk", false, "a", 1, 0],
        ["other", true, "a", 0, 1],
      ].sort(byProjection),
    );
  });
});
