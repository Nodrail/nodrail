// Declared receipts on the Cloud runtime path: the
// server reads a step's receipt with the agent's receipt contract from the
// live rules, answers its state, keeps an authoritative event with only the
// projection, and gates read it, with a path-level reason when they hold.
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { RunHoldDto } from "@/contracts/v1/runs";
import { dispatch, publish, step, work } from "./runs-world";
import {
  admin,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

useDatabase();

const CONTRACT_RULES = `- required_engine_version: 4

- contracts:
    shapes:
      reviewer-result:
        properties:
          verdict: { values: [ship, fix-first], role: verdict }
          findings:
            role: findings
            properties: { blocker: { type: integer, min: 0 } }
          notes: { type: string, max: 200, optional: true, report: true }
          token: { type: string, max: 100, optional: true, classification: secret }
    receipts:
      reviewer: { shape: reviewer-result }

- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow

- gate: Reviewed before the pull request
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: github }
  requires:
    - agent: reviewer
      verdict: [ship]
      where: { findings.blocker: 0 }
      since: [dev]
`;

const block = (body: string) =>
  `Done.\n\n\`\`\`nodrail-receipt\n${body}\n\`\`\``;
const SHIP = block("verdict: ship\nfindings: { blocker: 0 }\nnotes: fine");

async function rig() {
  const { w, token } = await workspaceWithToken();
  await publish(w, CONTRACT_RULES);
  return { w, token };
}

const started = (token: string, key: string, id: string) =>
  step(token, {
    run: { key },
    step: { id, agent: "reviewer" },
    event: "started",
  });

const finish = (
  token: string,
  key: string,
  id: string,
  extra: Record<string, unknown> = {},
) =>
  step(token, {
    run: { key },
    step: { id, agent: "reviewer" },
    event: "finished",
    ...extra,
  });

async function review(token: string, key: string, text: string | null) {
  const id = `reviewer-${randomUUID().slice(0, 8)}`;
  await started(token, key, id);
  const answer = await finish(
    token,
    key,
    id,
    text === null ? {} : { receipt: { text } },
  );
  return { id, answer };
}

/** The gate denies the dispatch; what it recorded about the requirement. */
async function heldCheck(w: TestWorkspace, token: string, key: string) {
  const status = await dispatch(token, "github", { key });
  expect(status).toMatchObject({ code: "DENIED", reason: "gate" });
  const [row]: { run_hold: RunHoldDto | null }[] = await admin.query(
    `SELECT run_hold FROM nodrail.action_requests
     WHERE workspace_id = $1 AND id = $2`,
    [w.id, status.action_id],
  );
  return row?.run_hold?.requirements?.[0];
}

const events = (workspaceId: string) =>
  admin.query(
    `SELECT authority, producer_class, validated_by, capture, validation,
            verdict, findings_count, payload, redacted, issues, run_id, step,
            installation_id, idempotency_key, contract_digest,
            projection_digest
     FROM nodrail.contract_events WHERE workspace_id = $1
     ORDER BY received_at`,
    [workspaceId],
  ) as Promise<Record<string, unknown>[]>;

describe("publishing a rules file with declared receipts", () => {
  test("pins the receipt contract and its projection", async () => {
    const { w } = await rig();
    const revisions = (await admin.query(
      `SELECT surface, name FROM nodrail.contract_revisions WHERE workspace_id = $1`,
      [w.id],
    )) as unknown[];
    const projections = (await admin.query(
      `SELECT surface, registered_via, withheld FROM nodrail.contract_projections
       WHERE workspace_id = $1`,
      [w.id],
    )) as unknown[];
    expect(revisions).toEqual([{ surface: "receipt", name: "reviewer" }]);
    expect(projections).toEqual([
      {
        surface: "receipt",
        registered_via: "publish",
        withheld: ["findings", "token"],
      },
    ]);
  });
});

describe("a finished step with a declared receipt", () => {
  test("a valid receipt is answered, kept authoritatively and meets the gate", async () => {
    const { w, token } = await rig();
    const { id, answer } = await review(token, "feat/ok", SHIP);
    expect(answer).toEqual({
      recorded: true,
      receipt: { state: "valid", reason: null },
    });
    expect((await dispatch(token, "github", { key: "feat/ok" })).code).toBe(
      "READY",
    );
    const [event] = await events(w.id);
    expect(event).toMatchObject({
      authority: "authoritative",
      producer_class: "agent-reported",
      validated_by: "server",
      capture: "captured",
      validation: "valid",
      verdict: "ship",
      payload: { verdict: "ship", notes: "fine" },
      redacted: ["findings", "token"],
      step: id,
    });
    expect(event?.installation_id).toBeTruthy();
    // It names the projection publishing pinned, so views can read it.
    const [pinned] = (await admin.query(
      `SELECT digest FROM nodrail.contract_projections WHERE workspace_id = $1`,
      [w.id],
    )) as { digest: string }[];
    expect(event?.projection_digest).toBe(pinned?.digest);
  });

  test("a receipt that meets it, followed by more work, holds with that reason", async () => {
    const { w, token } = await rig();
    const key = "feat/changed";
    await review(token, key, SHIP);
    await work(token, key, "dev", "done");
    const status = await heldCheck(w, token, key);
    expect(status).toMatchObject({
      met: false,
      check: {
        reason: "work_changed",
        nextStep: "Rerun reviewer on the current work.",
      },
    });
  });

  test("a secret value is kept neither with the run nor in the event", async () => {
    const { w, token } = await rig();
    await review(
      token,
      "feat/secret",
      block("verdict: ship\nfindings: { blocker: 0 }\ntoken: hunter2-secret"),
    );
    const rows = (await admin.query(
      `SELECT receipt::text AS receipt FROM nodrail.run_steps WHERE workspace_id = $1`,
      [w.id],
    )) as { receipt: string }[];
    expect(rows[0]?.receipt).not.toContain("hunter2");
    expect(JSON.stringify(await events(w.id))).not.toContain("hunter2");
  });

  test("an invalid receipt is answered with its reason and holds the gate at its path", async () => {
    const { w, token } = await rig();
    const { answer } = await review(
      token,
      "feat/bad",
      block("verdict: ship\nfindings: { blocker: many }"),
    );
    expect(answer).toMatchObject({
      recorded: true,
      receipt: {
        state: "invalid",
        reason: expect.stringContaining("findings.blocker") as string,
      },
    });
    const status = await heldCheck(w, token, "feat/bad");
    expect(status).toMatchObject({ met: false, check: { reason: "invalid" } });
    // The issue names the withheld parent by name, never the value.
    expect(JSON.stringify(status)).not.toContain("many");
    const [event] = await events(w.id);
    expect(event).toMatchObject({
      validation: "invalid",
      verdict: null,
      payload: {},
      issues: [{ path: "findings", code: "type" }],
    });
  });

  test("an unmet condition shows a redacted marker, never the value", async () => {
    const { w, token } = await rig();
    await review(
      token,
      "feat/blocked",
      block("verdict: ship\nfindings: { blocker: 2 }"),
    );
    const status = await heldCheck(w, token, "feat/blocked");
    expect(status?.check).toMatchObject({
      reason: "condition",
      conditions: [
        {
          path: "findings.blocker",
          expected: "= 0",
          observed: { kind: "redacted" },
          met: false,
        },
      ],
      nextStep: "Address it and rerun reviewer.",
    });
  });

  test("no receipt at all is missing, and a hook's own reading is refused", async () => {
    const { token } = await rig();
    expect((await review(token, "feat/none", null)).answer).toMatchObject({
      receipt: { state: "missing" },
    });
    const id = "reviewer-read";
    await started(token, "feat/read", id);
    expect(
      await finish(token, "feat/read", id, {
        receipt: { verdict: "ship", findings: [], usage: {} },
      }),
    ).toMatchObject({ receipt: { state: "invalid" } });
  });
});

describe("finishing twice", () => {
  test("an unusable receipt can be replaced; a usable one is final", async () => {
    const { w, token } = await rig();
    const key = "feat/again";
    const { id } = await review(token, key, block("verdict: maybe"));
    // The hand-back was refused, and the agent sends it again.
    expect(
      await finish(token, key, id, {
        receipt: { text: SHIP },
        via: "handback",
      }),
    ).toMatchObject({ receipt: { state: "valid" } });
    expect((await dispatch(token, "github", { key })).code).toBe("READY");
    // The same receipt again changes nothing; the stop that follows with
    // no message is a different finish, and refused.
    expect(
      await finish(token, key, id, { receipt: { text: SHIP } }),
    ).toMatchObject({
      receipt: { state: "valid" },
    });
    await expect(finish(token, key, id)).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
    });
    await expect(
      finish(token, key, id, {
        receipt: {
          text: block("verdict: fix-first\nfindings: { blocker: 1 }"),
        },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const stored = (await admin.query(
      `SELECT receipt->'contract'->>'via' AS via, verdict FROM nodrail.run_steps
       WHERE workspace_id = $1`,
      [w.id],
    )) as unknown[];
    expect(stored).toEqual([{ via: "handback", verdict: "ship" }]);
    expect((await events(w.id)).map((e) => e.validation)).toEqual([
      "invalid",
      "valid",
    ]);
  });
});

describe("agents without a declared receipt", () => {
  test("are read by the fixed parser, as before", async () => {
    const { token } = await rig();
    const answer = await step(token, {
      run: { key: "feat/plain" },
      step: { id: "qa-1", agent: "qa" },
      event: "finished",
      receipt: { text: block("verdict: pass") },
    });
    expect(answer).toEqual({ recorded: true });
  });
});
