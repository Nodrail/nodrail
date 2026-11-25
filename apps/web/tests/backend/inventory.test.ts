// The team's inventory (W4): machines report over OTLP with a reporting
// token, each report is its person's own, only the latest is kept, and who
// sees what follows the role.
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { withWorkspace } from "@/server/db/context";
import { createApiToken } from "@/server/modules/api-tokens";
import {
  listInventory,
  publishIntendedRevision,
} from "@/server/modules/inventory";
import { removeMember } from "@/server/modules/team/members";
import * as traces from "@/app/api/v1/otlp/v1/traces/route";
import {
  json,
  observation,
  PROJECT_ID,
  reportingToken,
  REVISION,
  send,
  type SpanRecord,
} from "./reporting-world";
import * as inventory from "@/app/api/v1/inventory/route";
import * as revisions from "@/app/api/v1/workspace-revisions/route";
import {
  addMember,
  admin,
  createWorkspace,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const decision: SpanRecord = {
  ...observation(),
  name: "nodrail.decision",
  attributes: { "nodrail.decision": "allow" },
};

const listed = (w: TestWorkspace, person: Person) =>
  withWorkspace(person, w.id, (context) =>
    listInventory(context, "development"),
  );

describe("reporting tokens", () => {
  test("hold inventory:write alone and read nothing", async () => {
    const w = await createWorkspace();
    const { token } = await withWorkspace(w.owner, w.id, (context) =>
      createApiToken(context, {
        name: "observe",
        scopes: ["inventory:write"],
        expiresInDays: 90,
      }),
    );
    expect(token.scopes).toEqual(["inventory:write"]);
    await expect(
      withWorkspace(w.owner, w.id, (context) =>
        createApiToken(context, {
          name: "both",
          scopes: ["inventory:write", "decide"],
          expiresInDays: 90,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const secret = await reportingToken(w, w.owner);
    const answer = await inventory.GET(
      new NextRequest("http://localhost/api/v1/inventory", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(
      ((await answer.json()) as { error: { code: string } }).error.code,
    ).toBe("INSUFFICIENT_SCOPE");
  });
});

describe("OTLP ingestion", () => {
  test("keeps observations as the token's person's; other spans rejected, counted", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const answer = await send(secret, [observation(), decision]);
    expect(answer.status).toBe(200);
    expect(answer.type).toBe("application/x-protobuf");
    // partial_success { rejected_spans: 1, error_message }
    expect(Array.from(answer.bytes.slice(0, 4))).toEqual([
      0x0a,
      answer.bytes.length - 2,
      0x08,
      1,
    ]);
    const { rows, summary } = await listed(w, w.owner);
    expect(rows).toEqual([
      expect.objectContaining({
        mine: true,
        machine: "aaaaaaaa",
        project: "desk",
        host: "claude-code",
        agent: "lead",
        activation: "configured",
        inStep: true,
        unmanaged: { skill: 2 },
        names: null,
        appliedRevision: REVISION,
        stale: false,
      }),
    ]);
    // Configured is not verified, and a stale report counts only as stale.
    expect(summary).toEqual({
      reports: 1,
      verified: 0,
      configured: 1,
      inactive: 0,
      unknown: 0,
      stale: 0,
      drifted: 0,
      behind: 0,
    });
  });

  test("only the latest is kept: an older one never replaces it", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    await send(secret, [
      observation({ "nodrail.drift": "3" }, Date.now() - 1000),
    ]);
    await send(secret, [
      observation({ "nodrail.drift": "1" }, Date.now() - 60 * 60_000),
    ]);
    expect((await listed(w, w.owner)).rows.map((row) => row.drift)).toEqual([
      3,
    ]);
    await send(secret, [
      observation({ "nodrail.drift": "0", "nodrail.in_step": "false" }),
    ]);
    const { rows } = await listed(w, w.owner);
    expect(rows.map((row) => [row.drift, row.inStep])).toEqual([[0, false]]);
  });

  test("JSON, names when sent, and stale after a day", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const named = observation(
      {
        "nodrail.unmanaged.names": JSON.stringify(["skill own (project)"]),
        "nodrail.drift.names": "[]",
      },
      Date.now() - 30 * 3_600_000,
    );
    const answer = await send(secret, [named], { protocol: "otlp-http/json" });
    expect(answer.status).toBe(200);
    expect(json(answer.bytes)).toEqual({});
    const [row] = (await listed(w, w.owner)).rows;
    expect(row).toMatchObject({
      names: { drift: [], unmanaged: ["skill own (project)"] },
      stale: true,
    });
  });

  test("malformed spans and bodies are refused", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    const bad = [
      observation({ "nodrail.machine": "my-laptop.local" }),
      observation({ "nodrail.workspace.revision": "/home/example" }),
      observation({ "nodrail.unmanaged.names": "not json" }),
      observation({}, Date.now() + 3_600_000),
    ];
    const answer = await send(secret, bad, { protocol: "otlp-http/json" });
    expect(json(answer.bytes).partialSuccess.rejectedSpans).toBe("4");
    expect((await listed(w, w.owner)).rows).toEqual([]);
    const garbage = await traces.POST(
      new NextRequest("http://localhost/api/v1/otlp/v1/traces", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/x-protobuf",
        },
        body: Uint8Array.from([0x0b, 0x00]),
      }),
    );
    expect(garbage.status).toBe(422);
    expect(
      (await send(secret, [observation()], { environment: "nowhere" })).status,
    ).toBe(404);
  });
});

describe("who sees the inventory", () => {
  test("admins see everyone; viewers their own; another workspace nothing; leaving removes theirs", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await send(await reportingToken(w, w.owner), [observation()]);
    await send(await reportingToken(w, viewer), [
      observation({ "nodrail.host": "codex" }),
    ]);
    expect(
      (await listed(w, w.owner)).rows.map((row) => [row.host, row.mine]),
    ).toEqual([
      ["claude-code", true],
      ["codex", false],
    ]);
    const own = await listed(w, viewer);
    expect(own.seesEveryone).toBe(false);
    expect(own.rows.map((row) => row.host)).toEqual(["codex"]);

    const other = await createWorkspace();
    expect((await listed(other, other.owner)).rows).toEqual([]);

    await withWorkspace(w.owner, w.id, (context) =>
      removeMember(context, viewer.userId),
    );
    const [{ count }] = (await admin.query(
      "SELECT count(*)::int AS count FROM nodrail.inventory_reports WHERE workspace_id = $1",
      [w.id],
    )) as { count: number }[];
    expect(count).toBe(1);
  });
});

describe("intended revisions", () => {
  const files = [{ path: "nodrail.yaml", sha256: "c".repeat(64) }];

  async function publishWith(
    w: TestWorkspace,
    person: Person,
    revision: string,
  ) {
    const { secret } = await withWorkspace(person, w.id, (context) =>
      createApiToken(context, {
        name: `publish-${revision.slice(0, 4)}`,
        scopes: ["rules:write"],
        expiresInDays: 90,
      }),
    );
    const response = await revisions.POST(
      new NextRequest("http://localhost/api/v1/workspace-revisions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project_id: PROJECT_ID,
          project: "desk",
          revision,
          files,
        }),
      }),
      { params: Promise.resolve({}) },
    );
    return { status: response.status, json: (await response.json()) as any };
  }

  test("published by a policy manager; rows behind it say so; Activity records it", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    await send(secret, [observation()], { projectId: PROJECT_ID });
    expect((await listed(w, w.owner)).rows[0]).toMatchObject({
      intendedRevision: null,
      behind: false,
    });

    const first = await publishWith(w, w.owner, REVISION);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      revision: {
        project_id: PROJECT_ID,
        project: "desk",
        revision: REVISION,
        files,
      },
      previous: null,
    });
    expect((await listed(w, w.owner)).rows[0]!.behind).toBe(false);

    const next = "d".repeat(64);
    expect((await publishWith(w, w.owner, next)).json.previous).toBe(REVISION);
    const after = await listed(w, w.owner);
    expect(after.rows[0]).toMatchObject({
      intendedRevision: next,
      behind: true,
    });
    expect(after.summary.behind).toBe(1);

    const [event] = (await admin.query(
      `SELECT decision_code, payload_safe FROM nodrail.audit_events
       WHERE workspace_id = $1 AND decision_code = 'workspace_revision_published'
       ORDER BY occurred_at DESC LIMIT 1`,
      [w.id],
    )) as { payload_safe: { subject: string; detail: string } }[];
    expect(event!.payload_safe).toEqual({
      subject: "desk",
      detail: `Revision ${next.slice(0, 12)}, was ${REVISION.slice(0, 12)}`,
    });
  });

  test("a report without the project's id is never compared, whatever its name", async () => {
    const w = await createWorkspace();
    const secret = await reportingToken(w, w.owner);
    await send(secret, [observation()]);
    await publishWith(w, w.owner, "d".repeat(64));
    const [row] = (await listed(w, w.owner)).rows;
    expect(row).toMatchObject({
      project: "desk",
      projectBound: false,
      intendedRevision: null,
      behind: false,
    });
  });

  test("a viewer can't publish; paths must stay in the project", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await expect(publishWith(w, viewer, REVISION)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const response = await withWorkspace(w.owner, w.id, (context) =>
      publishIntendedRevision(context, "development", {
        project_id: PROJECT_ID,
        project: "desk",
        revision: REVISION,
        files: [{ path: "../etc/passwd", sha256: REVISION }],
      }),
    ).catch((error: unknown) => error);
    expect(response).toMatchObject({ code: "INVALID_INPUT" });
  });
});
