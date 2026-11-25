// Briefs, connection inputs and results in Cloud and self-hosted:
// the runtime submits the full value, the server validates it against the
// published contract and keeps only the projection; a result's execution
// and delivery stay apart from its conformance; reported spans carry the
// same states; Runs and local runs show them; secrets never come back in
// answers, rows or the API; older and newer clients are refused cleanly.
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import * as events from "@/app/api/v1/contract-events/route";
import * as runtimeEvents from "@/app/api/v1/runtime/contract-events/route";
import {
  compileContracts,
  type CompiledShape,
} from "@/contracts/v1/shapes-engine";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { submitContractEvent } from "@/server/modules/contracts/submit";
import { publishIntendedRevision } from "@/server/modules/inventory";
import { listLocalRuns } from "@/server/modules/reporting/list";
import { getRun } from "@/server/modules/runs";
import { ENV, call, dispatch, rig, step } from "./runs-world";
import { json, postJson, reportingToken, send, span } from "./reporting-world";
import {
  admin,
  createAgent,
  inEachMode,
  issueToken,
  readerToken,
  useDatabase,
} from "./world";

useDatabase();

const SECRET = "sk_live_hunter2_never";

const compiled = compileContracts({
  manifest: {
    shapes: {
      "review-brief": {
        properties: {
          issue: { type: "string", max: 40, report: true },
          scope: { values: ["small", "large"], report: true },
        },
      },
      "refund-input": {
        properties: {
          amount: { type: "integer", min: 1, max: 5000, report: true },
          api_key: { type: "string", max: 100, classification: "secret" },
        },
      },
      "refund-result": {
        properties: {
          status: { values: ["refunded", "pending"], report: true },
          id: { type: "string", max: 40 },
        },
      },
    },
  },
  resources: [],
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
const shape = (name: string): CompiledShape =>
  compiled.contracts!.shapes[name]!;
const brief = shape("review-brief");
const input = shape("refund-input");
const result = shape("refund-result");

const PROJECT_ID = "5c2a1f3e-7b8d-4c9a-8e1f-2a3b4c5d6e7f";

const revision = (name: string, surface: string, s: CompiledShape) => ({
  digest: s.contract,
  name,
  surface,
  dialect: 1,
  shape: s.shape,
});

async function published() {
  const { w, token } = await rig();
  await withWorkspace(w.owner, w.id, (context) =>
    publishIntendedRevision(context, ENV, {
      project_id: PROJECT_ID,
      project: "desk",
      revision: "3".repeat(64),
      files: [],
      contracts: {
        revisions: [
          revision("review-brief", "brief", brief),
          revision("refund-input", "tool_input", input),
          revision("refund-result", "tool_result", result),
        ],
        bindings: [
          {
            surface: "brief",
            target: "brief:reviewer",
            contract_digest: brief.contract,
          },
          {
            surface: "tool_input",
            target: "input:stripe.refund",
            contract_digest: input.contract,
          },
          {
            surface: "tool_result",
            target: "output:stripe.refund",
            contract_digest: result.contract,
          },
        ],
      },
    }),
  );
  return { w, token };
}

const submit = (token: string, body: Record<string, unknown>) =>
  call(token, "actions:submit", (context) =>
    submitContractEvent(context, {
      idempotency_key: randomUUID(),
      ...body,
    }),
  );

const stored = (workspaceId: string) =>
  admin.query(
    `SELECT surface, authority, producer_class, validated_by, capture,
            validation, execution, delivered, payload, redacted, issues,
            action_digest, run_id, step
     FROM nodrail.contract_events WHERE workspace_id = $1
     ORDER BY received_at`,
    [workspaceId],
  ) as Promise<Record<string, unknown>[]>;

inEachMode(() => {
  describe("submitted on the runtime path", () => {
    test("an input is validated by the server and kept as its projection only", async () => {
      const { w, token } = await published();
      const action = await dispatch(token, "helper", { key: "feat/x" });
      const answer = await submit(token, {
        surface: "tool_input",
        contract_digest: input.contract,
        action_digest: action.action_digest,
        capture: "captured",
        payload: { amount: 120, api_key: SECRET },
      });
      expect(answer).toMatchObject({
        validation: "valid",
        issues: [],
        issue_count: 0,
      });
      const [row] = await stored(w.id);
      expect(row).toMatchObject({
        surface: "tool_input",
        authority: "authoritative",
        producer_class: "runtime-observed",
        validated_by: "server",
        validation: "valid",
        payload: { amount: 120 },
        redacted: ["api_key"],
        action_digest: action.action_digest,
      });
      expect(JSON.stringify(await stored(w.id))).not.toContain(SECRET);
    });

    test("an invalid input names paths and codes, never the value", async () => {
      const { w, token } = await published();
      const answer = await submit(token, {
        surface: "tool_input",
        contract_digest: input.contract,
        capture: "captured",
        payload: { amount: 0, api_key: { leaked: SECRET }, extra: SECRET },
      });
      expect(answer.validation).toBe("invalid");
      expect(answer.issues).toEqual(
        expect.arrayContaining([
          { path: "amount", code: "below" },
          { path: "api_key", code: "type" },
          // A made-up key is no declared name: its code stays, its path goes.
          { path: null, code: "unknown" },
        ]),
      );
      expect(JSON.stringify(answer)).not.toContain(SECRET);
      expect(JSON.stringify(await stored(w.id))).not.toContain(SECRET);
    });

    test("a result keeps what the provider did apart from whether it conformed", async () => {
      const { w, token } = await published();
      const unusable = await submit(token, {
        surface: "tool_result",
        contract_digest: result.contract,
        capture: "captured",
        payload: { status: "exploded", id: "re_1" },
        execution: "succeeded",
        delivered: false,
      });
      expect(unusable.validation).toBe("invalid");
      await submit(token, {
        surface: "tool_result",
        contract_digest: result.contract,
        capture: "missing",
        execution: "not-called",
        delivered: false,
      });
      const rows = await stored(w.id);
      expect(rows.map((r) => [r.validation, r.execution, r.delivered])).toEqual(
        [
          ["invalid", "succeeded", false],
          [null, "not-called", false],
        ],
      );
    });

    test.each([
      [
        "an invalid result marked delivered",
        {
          surface: "tool_result",
          capture: "captured",
          payload: { status: "nope", id: "x" },
          delivered: true,
        },
        "INVALID_INPUT",
      ],
      [
        "a result captured from a call that wasn't made",
        {
          surface: "tool_result",
          capture: "captured",
          payload: { status: "refunded", id: "x" },
          execution: "not-called",
        },
        "INVALID_INPUT",
      ],
      [
        "an execution on an input",
        { surface: "tool_input", capture: "missing", execution: "failed" },
        "INVALID_INPUT",
      ],
      [
        "a field this version doesn't know",
        { surface: "tool_input", capture: "missing", dialect: 2 },
        "INVALID_INPUT",
      ],
      [
        "a surface not enforced on this path yet",
        { surface: "memory_record", capture: "missing" },
        "INVALID_INPUT",
      ],
    ])("refuses %s", async (_, body, code) => {
      const { token } = await published();
      const digest =
        body.surface === "tool_result" ? result.contract : input.contract;
      await expect(
        submit(token, { contract_digest: digest, ...body }),
      ).rejects.toMatchObject({ code });
    });

    test("an unpublished contract, or another installation's action, is not found", async () => {
      const { w, token } = await published();
      await expect(
        submit(token, {
          surface: "tool_input",
          contract_digest: result.contract,
          capture: "missing",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // The same workspace, another installation: its action isn't ours.
      const theirs = await issueToken(w, await createAgent(w, "other-bot"));
      const action = await dispatch(theirs, "helper", { key: "feat/them" });
      await expect(
        submit(token, {
          surface: "tool_input",
          contract_digest: input.contract,
          capture: "missing",
          action_digest: action.action_digest,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    test("a retry answers as the first; another event under its key is refused", async () => {
      const { token } = await published();
      const key = randomUUID();
      const body = {
        idempotency_key: key,
        surface: "tool_input",
        contract_digest: input.contract,
        capture: "captured",
        payload: { amount: 1, api_key: SECRET },
      };
      const first = await submit(token, body);
      expect(await submit(token, body)).toEqual(first);
      await expect(
        submit(token, {
          ...body,
          surface: "brief",
          contract_digest: brief.contract,
          payload: { issue: "a", scope: "small" },
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    });

    /** A captured refund input under a key of its own. */
    const refund = (payload: object) => ({
      idempotency_key: randomUUID(),
      surface: "tool_input",
      contract_digest: input.contract,
      capture: "captured",
      payload,
    });

    test("another payload under the same key is refused, not answered as the first", async () => {
      const { w, token } = await published();
      const body = refund({ amount: 1, api_key: SECRET });
      const first = await submit(token, body);
      for (const payload of [
        { amount: 2, api_key: SECRET },
        // A withheld field differs: the projection alone can't tell.
        { amount: 1, api_key: "another" },
        { amount: 0 },
      ])
        await expect(submit(token, { ...body, payload })).rejects.toMatchObject(
          { code: "IDEMPOTENCY_CONFLICT" },
        );
      await expect(
        submit(token, { ...body, step: "another-step" }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      // The identical retry still answers as the first, key order aside.
      expect(
        await submit(token, {
          payload: { api_key: SECRET, amount: 1 },
          capture: "captured",
          contract_digest: input.contract,
          surface: "tool_input",
          idempotency_key: body.idempotency_key,
        }),
      ).toEqual(first);
      const rows = (await admin.query(
        `SELECT body_digest FROM nodrail.contract_events WHERE workspace_id = $1`,
        [w.id],
      )) as { body_digest: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    test("an event kept without a fingerprint can't be shown the same, so it is refused", async () => {
      const { w, token } = await published();
      const body = {
        idempotency_key: randomUUID(),
        surface: "tool_input",
        contract_digest: input.contract,
        capture: "missing",
      };
      await submit(token, body);
      await admin.query(
        `UPDATE nodrail.contract_events SET body_digest = NULL
         WHERE workspace_id = $1`,
        [w.id],
      );
      await expect(submit(token, body)).rejects.toMatchObject({
        code: "IDEMPOTENCY_CONFLICT",
      });
    });

    test("over the wire: issue_count in the answer, 409 for another payload", async () => {
      const { token } = await published();
      const post = (body: object) =>
        postJson(runtimeEvents.POST, "runtime/contract-events", token, body);
      const body = refund({ amount: 0, api_key: SECRET });
      const first = await post(body);
      expect(first.status).toBe(200);
      expect(first.json).toMatchObject({
        validation: "invalid",
        issue_count: 1,
      });
      expect(first.json).not.toHaveProperty("issueCount");
      expect(await post(body)).toEqual(first);
      const other = await post({
        ...body,
        payload: { amount: 3, api_key: SECRET },
      });
      expect(other.status).toBe(409);
      expect(other.json.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });

  describe("shown on Runs", () => {
    test("a step's brief and an action's input and result, by their binding", async () => {
      const { w, token } = await published();
      const key = "feat/runs";
      await step(token, {
        run: { key },
        step: { id: "rev-1", agent: "reviewer" },
        event: "started",
      });
      await submit(token, {
        surface: "brief",
        contract_digest: brief.contract,
        run: { key },
        step: "rev-1",
        capture: "captured",
        payload: { issue: "ENG-1", scope: "small" },
      });
      const action = await dispatch(token, "helper", {
        key,
        step: { id: "rev-1", agent: "reviewer" },
      });
      for (const surface of ["tool_input", "tool_result"] as const)
        await submit(token, {
          surface,
          contract_digest:
            surface === "tool_input" ? input.contract : result.contract,
          action_digest: action.action_digest,
          capture: "captured",
          payload:
            surface === "tool_input"
              ? { amount: 9, api_key: SECRET }
              : { status: "refunded", id: "re_9" },
          ...(surface === "tool_result"
            ? { execution: "succeeded", delivered: true }
            : {}),
        });
      const [{ id: runId }] = (await admin.query(
        `SELECT id FROM nodrail.runs WHERE workspace_id = $1 AND key = $2`,
        [w.id, key],
      )) as { id: string }[];
      const detail = await readWorkspace(w.owner, w.id, (context) =>
        getRun(context, ENV, runId!),
      );
      const started = detail.timeline.find((e) => e.kind === "started");
      const acted = detail.timeline.find((e) => e.kind === "action");
      expect(
        started?.kind === "started" &&
          started.step.exchanges?.map((e) => e.surface),
      ).toEqual(["brief"]);
      expect(
        acted?.kind === "action" &&
          acted.action.exchanges?.map((e) => [e.surface, e.redacted]),
      ).toEqual([
        ["tool_input", ["api_key"]],
        ["tool_result", ["id"]],
      ]);
      expect(JSON.stringify(detail)).not.toContain(SECRET);
    });
  });

  describe("reported over OTLP (schema 3)", () => {
    const projection = (s: CompiledShape) => s.projection;
    const reported = (extra: Record<string, string>) =>
      span("nodrail.contract.event", {
        "nodrail.host": "claude-code",
        "nodrail.machine": "f".repeat(32),
        "nodrail.run": "a".repeat(32),
        "nodrail.step": "s1",
        "nodrail.agent": "builder",
        "nodrail.contract.surface": "tool_result",
        "nodrail.contract.name": "refund-result",
        "nodrail.contract.digest": result.contract,
        "nodrail.contract.dialect": "1",
        "nodrail.contract.producer": "runtime-observed",
        "nodrail.contract.capture": "captured",
        "nodrail.contract.validation": "invalid",
        "nodrail.contract.projection": projection(result).digest,
        "nodrail.contract.payload": "{}",
        "nodrail.contract.issues": JSON.stringify([
          { path: "status", code: "enum" },
        ]),
        "nodrail.contract.execution": "succeeded",
        "nodrail.contract.delivered": "false",
        ...extra,
      });

    async function reporting() {
      const { w } = await published();
      const token = await reportingToken(w, w.owner);
      return { w, token };
    }

    const rejectedOf = (r: { bytes: Uint8Array }) =>
      Number(json(r.bytes).partialSuccess?.rejectedSpans ?? 0);

    test("a result keeps execution and delivery, and local runs show it", async () => {
      const { w, token } = await reporting();
      const sent = await send(
        token,
        [
          span("nodrail.run.event", {
            "nodrail.host": "claude-code",
            "nodrail.machine": "f".repeat(32),
            "nodrail.run": "a".repeat(32),
            "nodrail.step": "s1",
            "nodrail.agent": "builder",
            "nodrail.run.event": "step.started",
          }),
          reported({}),
        ],
        { protocol: "otlp-http/json", schema: "3" },
      );
      expect(rejectedOf(sent)).toBe(0);
      const [run] = await withWorkspace(w.owner, w.id, (context) =>
        listLocalRuns(context, ENV),
      );
      expect(run?.steps[0]?.exchanges).toMatchObject([
        {
          surface: "tool_result",
          validation: "invalid",
          execution: "succeeded",
          delivered: false,
          authorizes: false,
        },
      ]);
    });

    test.each([
      [
        "delivered on an input",
        { "nodrail.contract.surface": "tool_input" },
        "3",
      ],
      [
        "an invalid result delivered",
        { "nodrail.contract.delivered": "true" },
        "3",
      ],
      ["a later dialect", { "nodrail.contract.dialect": "2" }, "3"],
      ["a newer reporting schema", {}, "4"],
      ["a contract span under schema 2", {}, "2"],
    ])("refuses %s", async (_, extra, schema) => {
      const { token } = await reporting();
      const sent = await send(token, [reported(extra)], {
        protocol: "otlp-http/json",
        schema,
      });
      expect(rejectedOf(sent)).toBe(1);
    });
  });

  test("the events API never returns a secret, in any state", async () => {
    const { w, token } = await published();
    await submit(token, {
      surface: "tool_input",
      contract_digest: input.contract,
      capture: "captured",
      payload: { amount: 3, api_key: SECRET },
    });
    await submit(token, {
      surface: "tool_input",
      contract_digest: input.contract,
      capture: "captured",
      payload: { amount: -1, api_key: SECRET },
    });
    const secret = await readerToken(w);
    const response = await events.GET(
      new NextRequest("http://localhost/api/v1/contract-events", {
        headers: { authorization: `Bearer ${secret}` },
      }),
      { params: Promise.resolve({}) },
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("api_key");
    expect(text).not.toContain(SECRET);
  });
});
