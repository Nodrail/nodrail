// Declared contract reporting, in both deployment modes: receipt contract
// events reported over OTLP (schema 3) are kept against a registered
// projection, apart from anything authoritative; withheld fields stay
// names; duplicates, late arrivals, older clients and other workspaces are
// handled; the publish closure pins what the engine derives.
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, test } from "vitest";
import { withWorkspace } from "@/server/db/context";
import { applyRetention } from "@/server/maintenance/retention";
import {
  getContractEvent,
  listContractEvents,
} from "@/server/modules/contracts/read";
import { publishIntendedRevision } from "@/server/modules/inventory";
import { listLocalRuns } from "@/server/modules/reporting/list";
import * as events from "@/app/api/v1/contract-events/route";
import * as projections from "@/app/api/v1/contracts/projections/route";
import {
  closureInput,
  otherDigest,
  projectionInput,
  receiptAttributes,
  reviewer,
  without,
} from "../support/contract-fixtures";
import {
  json,
  postJson,
  PROJECT_ID,
  REVISION,
  reportingToken,
  send,
  span,
} from "./reporting-world";
import {
  addMember,
  admin,
  createWorkspace,
  inEachMode,
  readerToken,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const receipt = (extra: Record<string, string> = {}, at = Date.now()) =>
  span("nodrail.contract.event", receiptAttributes(extra), at);

/** Registers the reviewer projection with a reporting token. */
const register = (token: string, body: object = projectionInput()) =>
  postJson(projections.POST, "contracts/projections", token, body);

const rows = (w: TestWorkspace) =>
  admin.query(
    `SELECT authority, producer_class, validation, validated_by,
            projection_validation, verdict, findings_count, payload, redacted,
            issues, issue_count, occurred_at
     FROM nodrail.contract_events WHERE workspace_id = $1
     ORDER BY occurred_at`,
    [w.id],
  ) as Promise<Record<string, any>[]>;

const rejected = (result: { bytes: Uint8Array }) =>
  Number(json(result.bytes).partialSuccess?.rejectedSpans ?? 0);

const asJson = { protocol: "otlp-http/json" as const, schema: "3" };

inEachMode(() => {
  let w: TestWorkspace;
  let token: string;
  beforeAll(async () => {
    w = await createWorkspace();
    token = await reportingToken(w, w.owner);
  });

  describe("projections", () => {
    test("a reporting token registers one once; its digest is recomputed", async () => {
      expect(await register(token)).toMatchObject({
        status: 200,
        json: { registered: true },
      });
      expect(await register(token)).toMatchObject({
        json: { registered: false },
      });
      const forged = await register(token, {
        ...projectionInput(),
        withheld: ["issue"],
      });
      expect(forged.status).toBe(422);
      const [row] = await admin.query(
        `SELECT registered_via, withheld, fields FROM nodrail.contract_projections
         WHERE workspace_id = $1 AND digest = $2`,
        [w.id, reviewer.projection.digest],
      );
      expect(row.registered_via).toBe("report");
      expect(row.withheld).toEqual(["anchor", "issue", "note"]);
      expect(row.fields.map((field: { path: string }) => field.path)).toEqual([
        "verdict",
        "lesson",
        "findings.blocker",
        "findings.major",
      ]);
    });
  });

  describe("reported receipts", () => {
    test("a valid receipt is kept as a local report, with its verdict and withheld names", async () => {
      const result = await send(token, [receipt()], asJson);
      expect(rejected(result)).toBe(0);
      const [row] = await rows(w);
      expect(row).toMatchObject({
        authority: "reported",
        producer_class: "agent-reported",
        validation: "valid",
        validated_by: "producer",
        projection_validation: "valid",
        verdict: "ship",
        findings_count: 1,
        payload: { verdict: "ship", findings: { blocker: 0, major: 1 } },
        redacted: ["anchor", "issue", "note"],
      });
    });

    test("values that don't match the projection are not kept", async () => {
      const before = (await rows(w)).length;
      await send(
        token,
        [
          receipt({
            "nodrail.contract.payload": JSON.stringify({
              verdict: "ship",
              findings: { blocker: 0, major: 1 },
              anchor: "fresh",
            }),
          }),
        ],
        asJson,
      );
      const added = (await rows(w)).slice(before);
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        projection_validation: "invalid",
        verdict: null,
        payload: {},
      });
      expect(JSON.stringify(added)).not.toContain("fresh");
    });

    test("issue paths are cut to names the projection declares", async () => {
      const before = (await rows(w)).length;
      const invalid = receiptAttributes({
        "nodrail.contract.validation": "invalid",
        "nodrail.contract.issues": JSON.stringify([
          { path: "findings.blocker", code: "type" },
          { path: "anchor", code: "enum" },
          { path: "made_up_key", code: "unknown" },
          { path: "(value)", code: "type" },
        ]),
        "nodrail.contract.payload": "{}",
      });
      await send(
        token,
        [
          span(
            "nodrail.contract.event",
            without(invalid, "nodrail.contract.findings"),
          ),
        ],
        asJson,
      );
      const [added] = (await rows(w)).slice(before);
      expect(added).toMatchObject({
        validation: "invalid",
        issue_count: 4,
        issues: [
          { path: "findings.blocker", code: "type" },
          { path: "anchor", code: "enum" },
          { path: null, code: "unknown" },
          { path: null, code: "type" },
        ],
      });
    });

    test("refused and counted: unregistered projection, another contract's, a wrong verdict, a later dialect", async () => {
      const before = (await rows(w)).length;
      const result = await send(
        token,
        [
          receipt({ "nodrail.contract.projection": otherDigest("9") }),
          receipt({ "nodrail.contract.digest": otherDigest("8") }),
          receipt({ "nodrail.contract.verdict": "fix-first" }),
          receipt({ "nodrail.contract.dialect": "2" }),
          receipt({ "nodrail.contract.producer": "externally-verified" }),
        ],
        asJson,
      );
      expect(rejected(result)).toBe(5);
      expect((await rows(w)).length).toBe(before);
    });

    test("missing and unsupported are kept without values", async () => {
      const bare = (capture: string) =>
        span(
          "nodrail.contract.event",
          without(
            { ...receiptAttributes(), "nodrail.contract.capture": capture },
            "nodrail.contract.validation",
            "nodrail.contract.findings",
            "nodrail.contract.projection",
            "nodrail.contract.payload",
          ),
        );
      const result = await send(
        token,
        [bare("missing"), bare("unsupported")],
        asJson,
      );
      expect(rejected(result)).toBe(0);
      const kept = await admin.query(
        `SELECT capture, validation, payload, redacted FROM nodrail.contract_events
         WHERE workspace_id = $1 AND capture <> 'captured' ORDER BY capture`,
        [w.id],
      );
      expect(kept).toEqual([
        { capture: "missing", validation: null, payload: {}, redacted: [] },
        { capture: "unsupported", validation: null, payload: {}, redacted: [] },
      ]);
    });

    test("a retry is kept once", async () => {
      const once = receipt();
      const before = (await rows(w)).length;
      await send(token, [once], asJson);
      await send(token, [once], asJson);
      expect((await rows(w)).length).toBe(before + 1);
    });
  });

  describe("older and newer clients", () => {
    test("schema 2 keeps reporting; a contract span under it is refused", async () => {
      const v = await createWorkspace();
      const secret = await reportingToken(v, v.owner);
      await register(secret);
      const decision = span("nodrail.decision", {
        "nodrail.host": "claude-code",
        "nodrail.decision": "allow",
      });
      const result = await send(secret, [decision, receipt()], {
        protocol: "otlp-http/json",
        schema: "2",
      });
      expect(rejected(result)).toBe(1);
      expect(await rows(v)).toEqual([]);
      const [kept] = await admin.query(
        "SELECT count(*)::int AS n FROM nodrail.reported_events WHERE workspace_id = $1",
        [v.id],
      );
      expect(kept.n).toBe(1);
    });
  });

  describe("reading", () => {
    let v: TestWorkspace;
    let viewer: Person;
    beforeAll(async () => {
      v = await createWorkspace();
      viewer = await addMember(v, "viewer");
      const ownerToken = await reportingToken(v, v.owner);
      const viewerToken = await reportingToken(v, viewer);
      await register(ownerToken);
      const now = Date.now();
      // The later receipt arrives first: order is by when it happened.
      await send(
        ownerToken,
        [
          receipt({ "nodrail.run": "a".repeat(32) }, now),
          receipt(
            {
              "nodrail.run": "a".repeat(32),
              "nodrail.contract.payload": JSON.stringify({
                verdict: "fix-first",
                findings: { blocker: 2, major: 0 },
                lesson: "pin versions",
              }),
              "nodrail.contract.findings": "2",
            },
            now - 60_000,
          ),
        ],
        { ...asJson, projectId: PROJECT_ID },
      );
      await send(viewerToken, [receipt()], asJson);
    });

    test("admins see everyone's; a viewer only their own, and is told so", async () => {
      const all = await withWorkspace(v.owner, v.id, (context) =>
        listContractEvents(context, "development", {}),
      );
      expect(all.items).toHaveLength(3);
      expect(all.completeness).toEqual({ complete: true, reasons: [] });
      const own = await withWorkspace(viewer, v.id, (context) =>
        listContractEvents(context, "development", {}),
      );
      expect(own.items.map((item) => item.provenance.authority)).toEqual([
        "reported",
      ]);
      expect(own.completeness.reasons).toEqual(["own_reports_only"]);
    });

    test("another workspace sees none, even by id", async () => {
      const [first] = (
        await withWorkspace(v.owner, v.id, (context) =>
          listContractEvents(context, "development", {}),
        )
      ).items;
      const other = await createWorkspace();
      const page = await withWorkspace(other.owner, other.id, (context) =>
        listContractEvents(context, "development", {}),
      );
      expect(page.items).toEqual([]);
      await expect(
        withWorkspace(other.owner, other.id, (context) =>
          getContractEvent(context, "development", first!.id),
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("pages follow a cursor and say when there are more", async () => {
      const first = await withWorkspace(v.owner, v.id, (context) =>
        listContractEvents(context, "development", { limit: "2" }),
      );
      expect(first.items).toHaveLength(2);
      expect(first.completeness.reasons).toEqual(["more_pages"]);
      const second = await withWorkspace(v.owner, v.id, (context) =>
        listContractEvents(context, "development", {
          limit: "2",
          cursor: first.nextCursor!,
        }),
      );
      expect(second.items).toHaveLength(1);
      expect(second.nextCursor).toBeNull();
    });

    test("the inspector's event: redacted names, a reported field not provided, never authorizing", async () => {
      const page = await withWorkspace(v.owner, v.id, (context) =>
        listContractEvents(context, "development", { validation: "valid" }),
      );
      const ship = page.items.find((item) => item.verdict === "ship")!;
      expect(ship).toMatchObject({
        coverage: "S01",
        contract: {
          digest: reviewer.contract,
          availability: "projection_only",
          dialect: 1,
        },
        redacted: ["anchor", "issue", "note"],
        absent: ["lesson"],
        authorizes: false,
      });
    });

    test("the API answers with the same page, read-scoped", async () => {
      const secret = await readerToken(v);
      const response = await events.GET(
        new NextRequest(
          "http://localhost/api/v1/contract-events?surface=receipt",
          {
            headers: { authorization: `Bearer ${secret}` },
          },
        ),
        { params: Promise.resolve({}) },
      );
      const body = (await response.json()) as any;
      expect(response.status).toBe(200);
      expect(body.items).toHaveLength(3);
      expect(body.items[0].provenance.source_label).toMatch(/^Local/);
      const typo = await events.GET(
        new NextRequest("http://localhost/api/v1/contract-events?surfce=x", {
          headers: { authorization: `Bearer ${secret}` },
        }),
        { params: Promise.resolve({}) },
      );
      expect(typo.status).toBe(422);
    });

    test("a local run's step carries its latest receipt by when it happened", async () => {
      // Receipts alone never invent a local run.
      expect(
        await withWorkspace(v.owner, v.id, (context) =>
          listLocalRuns(context, "development"),
        ),
      ).toEqual([]);
      const secret = await reportingToken(v, v.owner);
      await send(
        secret,
        [
          span("nodrail.run.event", {
            "nodrail.host": "claude-code",
            "nodrail.machine": "f".repeat(32),
            "nodrail.run": "a".repeat(32),
            "nodrail.step": "review",
            "nodrail.agent": "reviewer",
            "nodrail.run.event": "step.finished",
          }),
        ],
        { ...asJson, projectId: PROJECT_ID },
      );
      const [run] = await withWorkspace(v.owner, v.id, (context) =>
        listLocalRuns(context, "development"),
      );
      expect(run!.steps[0]!.receipt).toMatchObject({
        verdict: "ship",
        findingsCount: 1,
      });
    });
  });

  describe("retention", () => {
    test("an event goes after a year; its projection stays while another names it", async () => {
      const v = await createWorkspace();
      const secret = await reportingToken(v, v.owner);
      await register(secret);
      await send(secret, [receipt(), receipt()], asJson);
      await admin.query(
        `UPDATE nodrail.contract_events SET received_at = now() - interval '2 years'
         WHERE id = (SELECT id FROM nodrail.contract_events WHERE workspace_id = $1 LIMIT 1)`,
        [v.id],
      );
      await admin.query(
        `UPDATE nodrail.contract_projections SET created_at = now() - interval '2 years'
         WHERE workspace_id = $1`,
        [v.id],
      );
      await applyRetention();
      expect(await rows(v)).toHaveLength(1);
      const [left] = await admin.query(
        "SELECT count(*)::int AS n FROM nodrail.contract_projections WHERE workspace_id = $1",
        [v.id],
      );
      expect(left.n).toBe(1);
    });
  });

  describe("publish closure", () => {
    test("pins the revision, the projection the engine derives, and the binding", async () => {
      const v = await createWorkspace();
      await withWorkspace(v.owner, v.id, (context) =>
        publishIntendedRevision(context, "development", {
          project_id: PROJECT_ID,
          project: "desk",
          revision: REVISION,
          files: [],
          contracts: closureInput(),
        }),
      );
      const [revision] = await admin.query(
        "SELECT digest, dialect, property_count FROM nodrail.contract_revisions WHERE workspace_id = $1",
        [v.id],
      );
      expect(revision).toEqual({
        digest: reviewer.contract,
        dialect: 1,
        property_count: 8,
      });
      const [binding] = await admin.query(
        "SELECT target, projection_digest FROM nodrail.contract_bindings WHERE workspace_id = $1",
        [v.id],
      );
      expect(binding).toEqual({
        target: "receipt:reviewer",
        projection_digest: reviewer.projection.digest,
      });
      const [projection] = await admin.query(
        "SELECT registered_via FROM nodrail.contract_projections WHERE workspace_id = $1",
        [v.id],
      );
      expect(projection.registered_via).toBe("publish");
    });

    test("a shape that isn't its digest is refused, and nothing is kept", async () => {
      const v = await createWorkspace();
      const closure = closureInput();
      closure.revisions[0]!.shape = {
        ...reviewer.shape,
        for: "changed after the digest",
      };
      await expect(
        withWorkspace(v.owner, v.id, (context) =>
          publishIntendedRevision(context, "development", {
            project_id: PROJECT_ID,
            project: "desk",
            revision: REVISION,
            files: [],
            contracts: closure,
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      const [left] = await admin.query(
        "SELECT count(*)::int AS n FROM nodrail.intended_revisions WHERE workspace_id = $1",
        [v.id],
      );
      expect(left.n).toBe(0);
    });
  });
});
