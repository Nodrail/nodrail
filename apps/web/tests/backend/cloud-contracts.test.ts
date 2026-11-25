// Declared contracts where Cloud decides, round 2: a subagent's hand-back
//, typed `where` on an operation's input or a started agent's brief
// read only from reported fields, what a publish keeps
// and refuses, the canonical projection digest (#110), and the brief and
// input checks a local decision reports (schema 3).
import { randomUUID } from "node:crypto";
import type {
  Descriptor,
  PolicyDocument,
  RunContext,
  SimulationResult,
} from "@nodrail/policy-engine";
import { compilePolicies } from "@nodrail/policy-engine/yaml";
import { beforeAll, describe, expect, test } from "vitest";
import { decideHandback } from "@/server/modules/runs/contracts";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { previewPolicyFile } from "@/server/modules/policies/rule-files";
import { listReportedDecisions } from "@/server/modules/reporting/list";
import { requestPermit, submitAction } from "@/server/modules/runtime";
import { contractDigest, projectShape } from "@/contracts/v1/shapes-engine";
import { reportingToken, send, span } from "./reporting-world";
import { ENV, call, publish, step } from "./runs-world";
import {
  admin,
  inEachMode,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
} from "./world";

useDatabase();

const submit = (
  token: string,
  descriptor: {
    tool: string;
    operation: string;
    resource: { kind: string; id: string };
    params: Record<string, unknown>;
  },
  run?: { key: string; step?: { id: string; agent: string } },
) =>
  call(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      ...descriptor,
      ...(run ? { run } : {}),
    }),
  );

const preview = (w: TestWorkspace, text: string) =>
  withWorkspace(w.owner, w.id, (context) =>
    previewPolicyFile(context, ENV, text),
  );

const CONTRACTS = `- required_engine_version: 4

- contracts:
    shapes:
      refund-args:
        properties:
          amount: { type: integer, min: 1, report: true }
          environment: { values: [staging, production] }
          card: { type: string, max: 64, classification: secret, optional: true }
      work-brief:
        properties:
          issue: { type: string, max: 40 }
          budget: { type: integer, min: 1, max: 500, report: true }
    agents:
      developer:
        brief: work-brief
    connections:
      stripe:
        operations:
          refund: { input: refund-args }
          charge: { input: refund-args }

- rule: Small refunds
  tool: stripe
  operation: refund
  resource: { kind: mcp_tool, match: any }
  where: { input.amount: { max: 5000 } }
  effect: allow

- rule: Staging charges
  tool: stripe
  operation: charge
  resource: { kind: mcp_tool, match: any }
  where: { input.environment: staging }
  effect: allow

- rule: Never charge production
  tool: stripe
  operation: charge
  resource: { kind: mcp_tool, match: any }
  where: { input.environment: production }
  effect: deny

- rule: Start the developer on a small budget
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: developer }
  where: { brief.budget: { max: 100 } }
  effect: allow
`;

const stripe = (operation: string, input?: unknown) => ({
  tool: "stripe",
  operation,
  resource: { kind: "mcp_tool", id: `stripe.${operation}` },
  params: {
    input_sha256: "0".repeat(64),
    ...(input === undefined ? {} : { input }),
  },
});

const developer = (brief?: unknown) => ({
  tool: "claude-code",
  operation: "agent",
  resource: { kind: "agent", id: "developer" },
  params: {
    subagent_type: "developer",
    ...(brief === undefined ? {} : { brief }),
  },
});

describe("where on a declared input or brief, in Cloud", () => {
  let w: TestWorkspace;
  let token: string;
  beforeAll(async () => {
    ({ w, token } = await workspaceWithToken());
    await publish(w, CONTRACTS);
  });

  test("a reported input decides: within the bound is allowed, past it isn't", async () => {
    expect((await submit(token, stripe("refund", { amount: 100 }))).code).toBe(
      "READY",
    );
    expect(
      (
        await submit(
          token,
          stripe("refund", { amount: 100, card: "[classified]" }),
        )
      ).code,
    ).toBe("READY");
    expect((await submit(token, stripe("refund", { amount: 9000 }))).code).toBe(
      "DENIED",
    );
  });

  test("without a conforming reported value an allow with where never matches", async () => {
    for (const input of [undefined, { amount: "100" }, { amount: 0 }, "x"])
      expect((await submit(token, stripe("refund", input))).code).toBe(
        "DENIED",
      );
  });

  test("a where on an unreported path fails closed: no allow, the deny applies", async () => {
    // environment isn't reported, so Cloud never reads it, even when sent.
    for (const environment of ["staging", "production"])
      expect(
        (await submit(token, stripe("charge", { amount: 1, environment })))
          .code,
      ).toBe("DENIED");
  });

  test("a started agent's reported brief decides", async () => {
    expect((await submit(token, developer({ budget: 50 }))).code).toBe("READY");
    // An unreported field sent along is not read, and changes nothing.
    expect(
      (await submit(token, developer({ budget: 50, issue: "ENG-1" }))).code,
    ).toBe("READY");
    for (const brief of [{ budget: 500 }, undefined, { issue: "ENG-1" }])
      expect((await submit(token, developer(brief))).code).toBe("DENIED");
  });

  test("a permit decides again with the same values the action carries", async () => {
    const status = await submit(token, stripe("refund", { amount: 100 }));
    const permit = await call(token, "permits:request", (context) =>
      requestPermit(context, status.action_id, {
        action_digest: status.action_digest,
        nonce: randomUUID(),
      }),
    );
    expect(permit.code).toBe("ALLOW");
  });

  test("the plan says which where Cloud can't read; publishing keeps them all", async () => {
    const planned = await preview(w, CONTRACTS);
    expect(planned.issues).toEqual([]);
    const said = planned.warnings.map((warning) => warning.message).join("\n");
    expect(said).toContain("Staging charges: where reads input.environment");
    expect(said).toContain("this allow never matches in Cloud");
    expect(said).toContain("Never charge production");
    expect(said).not.toContain("Small refunds");
    // Nothing changed: the where, briefs and inputs were kept, not dropped.
    expect(planned.added).toEqual([]);
    expect(planned.changed).toEqual([]);
    expect(planned.removed).toEqual([]);
  });

  test("a changed where is a changed rule", async () => {
    const planned = await preview(
      w,
      CONTRACTS.replace("{ max: 5000 }", "{ max: 4000 }"),
    );
    expect(planned.changed).toEqual(["Small refunds"]);
  });

  test("publishing pins the brief and input contracts by their shapes", async () => {
    const rows = (await admin.query(
      `SELECT surface, name FROM nodrail.contract_revisions
       WHERE workspace_id = $1 ORDER BY surface, name`,
      [w.id],
    )) as unknown[];
    expect(rows).toEqual([
      { surface: "brief", name: "work-brief" },
      { surface: "tool_input", name: "refund-args" },
    ]);
  });

  test("a rules file can't name a resource, so none comes from a classified argument", async () => {
    // A resource id is sent as it is. Only nodrail.yaml declares where
    // it comes from, and its compiler must refuse a classified argument; a
    // rules file published here can't declare it at all.
    const planned = await preview(
      w,
      CONTRACTS.replace(
        "refund: { input: refund-args }",
        "refund: { input: refund-args, resource: { kind: card, from: card } }",
      ),
    );
    expect(planned.issues).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('Unrecognized key: "resource"'),
      }),
    );
  });
});

const HANDBACK = {
  tool: "claude-code",
  operation: "subagenthandback",
  resource: { kind: "tool", id: "SubagentHandback" },
  params: { input_sha256: "0".repeat(64) },
};

const ONLY_READS = `- rule: Read
  tool: claude-code
  operation: read
  resource: { kind: file, match: any }
  effect: allow
`;

const RECEIPTS = `- required_engine_version: 4

- contracts:
    shapes:
      qa-result:
        properties:
          verdict: { values: [pass, fail], role: verdict }
    receipts:
      qa: { shape: qa-result }

${ONLY_READS}`;

describe("a subagent's hand-back in Cloud", () => {
  test("no rule covers it: it goes ahead", async () => {
    const { w, token } = await workspaceWithToken();
    await publish(w, ONLY_READS);
    expect((await submit(token, HANDBACK)).code).toBe("READY");
  });

  test("a rule that covers it decides", async () => {
    const { w, token } = await workspaceWithToken();
    await publish(
      w,
      `${ONLY_READS}
- rule: No hand-backs
  tool: claude-code
  operation: subagenthandback
  resource: { kind: tool, match: any }
  effect: deny
`,
    );
    expect((await submit(token, HANDBACK)).code).toBe("DENIED");
  });

  test("with a receipt contract, only a valid receipt hands back", async () => {
    const { w, token } = await workspaceWithToken();
    await publish(w, RECEIPTS);
    const key = "feat/handback";
    const qa = { id: `qa-${randomUUID().slice(0, 8)}`, agent: "qa" };
    await step(token, { run: { key }, step: qa, event: "started" });
    // Not finished yet: there is no receipt to hand back.
    expect((await submit(token, HANDBACK, { key, step: qa })).code).toBe(
      "DENIED",
    );
    const finish = (text: string) =>
      step(token, {
        run: { key },
        step: qa,
        event: "finished",
        via: "handback",
        receipt: { text: `\`\`\`nodrail-receipt\n${text}\n\`\`\`` },
      });
    expect(await finish("verdict: maybe")).toMatchObject({
      receipt: { state: "invalid" },
    });
    expect((await submit(token, HANDBACK, { key, step: qa })).code).toBe(
      "DENIED",
    );
    expect(await finish("verdict: pass")).toMatchObject({
      receipt: { state: "valid" },
    });
    expect((await submit(token, HANDBACK, { key, step: qa })).code).toBe(
      "READY",
    );
  });
});

// Version 4 (evidence declared) carries receipts as version 3 does.
const RECEIPTS_V4 = `- required_engine_version: 5

- contracts:
    shapes:
      qa-result:
        properties:
          verdict: { values: [pass, fail], role: verdict }
      ci-result:
        properties:
          status: { values: [passed, failed], report: true }
    receipts:
      qa: { shape: qa-result }
    evidence:
      ci-tests:
        shape: ci-result
        producers:
          - { class: runtime-observed }
        subject: revision

${ONLY_READS}`;

const handbackDescriptor: Descriptor = {
  agentId: "agent-1",
  installationId: "installation-1",
  toolKey: HANDBACK.tool,
  operationKey: HANDBACK.operation,
  resourceKind: HANDBACK.resource.kind,
  resourceId: HANDBACK.resource.id,
  params: HANDBACK.params,
};

const NONE: SimulationResult = {
  outcome: "none",
  matchedRuleId: null,
  explanation: "No rule covers this.",
} as SimulationResult;

/** The hand-back as Cloud decides it for this document and run. */
const handback = (document: PolicyDocument, run: RunContext | null) =>
  decideHandback(NONE, { document, descriptor: handbackDescriptor, run });

inEachMode(() => {
  describe("a hand-back a receipt contract can't check", () => {
    const decided = async (
      rules: string,
      run?: { key: string; step?: { id: string; agent: string } },
    ) => {
      const { w, token } = await workspaceWithToken();
      await publish(w, rules);
      return submit(token, HANDBACK, run);
    };

    test("without its run, a document that declares receipts denies it", async () => {
      const status = await decided(RECEIPTS);
      expect(status.code).toBe("DENIED");
      expect(status.reason).toBe("rule");
      // A run without the step is no better: the agent is still unknown.
      expect((await decided(RECEIPTS, { key: "feat/no-step" })).code).toBe(
        "DENIED",
      );
    });

    test("an agent with no receipt contract, or no receipts at all, is unchanged", async () => {
      const dev = { id: `dev-${randomUUID().slice(0, 8)}`, agent: "developer" };
      expect(
        (await decided(RECEIPTS, { key: "feat/dev", step: dev })).code,
      ).toBe("READY");
      expect((await decided(ONLY_READS)).code).toBe("READY");
    });

    test("a version 4 document is checked as version 3 is", () => {
      const compiled = compilePolicies([
        { name: "v4.yaml", text: RECEIPTS_V4 },
      ]);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
      const document = compiled.document;
      expect(document.version).toBe(4);
      const qa = { id: "qa-1", agent: "qa" };
      const started = {
        type: "step.started",
        step: qa.id,
        agent: qa.agent,
        at: new Date().toISOString(),
      };
      const finished = (state: string) => ({
        type: "step.finished",
        step: qa.id,
        agent: qa.agent,
        at: new Date().toISOString(),
        verdict: null,
        findings: [],
        usage: {},
        receipt: { state },
      });
      const run = (events: object[], step: typeof qa | null = qa) =>
        ({ run: "k", step, events }) as unknown as RunContext;

      expect(handback(document, null).explanation).toContain(
        "names no run step",
      );
      expect(handback(document, null).outcome).toBe("deny");
      expect(handback(document, run([started])).outcome).toBe("deny");
      expect(
        handback(document, run([started, finished("invalid")])).outcome,
      ).toBe("deny");
      expect(
        handback(document, run([started, finished("valid")])).outcome,
      ).toBe("allow");
      const dev = { id: "dev-1", agent: "developer" };
      expect(handback(document, run([], dev)).outcome).toBe("allow");
    });
  });
});

describe("projection digests after the engine sorts withheld paths", () => {
  const UNSORTED = `- required_engine_version: 4

- contracts:
    shapes:
      qa-result:
        properties:
          verdict: { values: [pass, fail], role: verdict }
          zeta: { type: string, max: 20, optional: true }
          alpha: { type: string, max: 20, optional: true }
    receipts:
      qa: { shape: qa-result }

${ONLY_READS}`;

  test("a projection pinned in another order isn't named by new events", async () => {
    const { w, token } = await workspaceWithToken();
    await publish(w, UNSORTED);
    const [pinned] = (await admin.query(
      `SELECT id, digest, schema, withheld FROM nodrail.contract_projections
       WHERE workspace_id = $1`,
      [w.id],
    )) as {
      id: string;
      digest: string;
      schema: Parameters<typeof projectShape>[0];
      withheld: string[];
    }[];
    expect(pinned?.withheld).toEqual(["alpha", "zeta"]);
    // As a publish before #110 stored it: declaration order, its own digest.
    const stale = contractDigest("projection", {
      shape: pinned!.schema,
      withheld: ["zeta", "alpha"],
    });
    expect(stale).not.toBe(pinned!.digest);
    await admin.query(
      `UPDATE nodrail.contract_projections SET digest = $2, withheld = $3
       WHERE id = $1`,
      [pinned!.id, stale, JSON.stringify(["zeta", "alpha"])],
    );
    const key = "feat/digest";
    const qa = { id: "qa-1", agent: "qa" };
    await step(token, { run: { key }, step: qa, event: "started" });
    await step(token, {
      run: { key },
      step: qa,
      event: "finished",
      receipt: { text: "```nodrail-receipt\nverdict: pass\n```" },
    });
    const [event] = (await admin.query(
      `SELECT projection_digest, redacted FROM nodrail.contract_events
       WHERE workspace_id = $1`,
      [w.id],
    )) as { projection_digest: string; redacted: string[] }[];
    expect(event).toEqual({
      projection_digest: pinned!.digest,
      redacted: ["alpha", "zeta"],
    });
  });
});

describe("a local decision's brief or input check, reported (schema 3)", () => {
  const BRIEF = `sha256:${"c".repeat(64)}`;
  const decision = (extra: Record<string, string>) =>
    span("nodrail.decision", {
      "nodrail.host": "claude-code",
      "nodrail.decision": "deny",
      "nodrail.tool": "claude-code",
      "nodrail.operation": "agent",
      ...extra,
    });

  test("is kept by state and contract, never a value", async () => {
    const { w } = await workspaceWithToken();
    const secret = await reportingToken(w, w.owner);
    await send(
      secret,
      [
        decision({
          "nodrail.brief.state": "unobservable",
          "nodrail.brief.contract": BRIEF,
        }),
      ],
      { protocol: "otlp-http/json", schema: "3" },
    );
    const [kept] = await readWorkspace(w.owner, w.id, (context) =>
      listReportedDecisions(context, ENV),
    );
    expect(kept?.check).toEqual({
      surface: "brief",
      state: "unobservable",
      contract: BRIEF,
    });
  });

  test("half a check, both checks or a check under schema 2 is refused or ignored", async () => {
    const { w } = await workspaceWithToken();
    const secret = await reportingToken(w, w.owner);
    const answer = await send(
      secret,
      [
        decision({ "nodrail.input.state": "invalid" }),
        decision({
          "nodrail.input.state": "invalid",
          "nodrail.input.contract": BRIEF,
          "nodrail.brief.state": "valid",
          "nodrail.brief.contract": BRIEF,
        }),
      ],
      { protocol: "otlp-http/json", schema: "3" },
    );
    expect(answer.status).toBe(200);
    await send(
      secret,
      [
        decision({
          "nodrail.input.state": "invalid",
          "nodrail.input.contract": BRIEF,
        }),
      ],
      { protocol: "otlp-http/json", schema: "2" },
    );
    const kept = await readWorkspace(w.owner, w.id, (context) =>
      listReportedDecisions(context, ENV),
    );
    expect(kept.map((row) => row.check)).toEqual([null]);
  });
});
