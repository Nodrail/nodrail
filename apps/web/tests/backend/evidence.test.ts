// Evidence from verifiers: a CI job's GitHub Actions OIDC
// token, checked against a local test issuer (never a real GitHub token),
// proves which workflow produced the evidence and for which commit. Forged
// claims, expired tokens, replays and conflicting retries are refused; an
// identical retry answers the stored event; the secret never reaches a row;
// a revoked verifier's evidence stops counting retroactively; a reported row
// never satisfies; the status endpoint evaluates only what a published
// revision pinned.
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import * as evidenceRoute from "@/app/api/v1/evidence/route";
import * as statusRoute from "@/app/api/v1/evidence/status/route";
import {
  GITHUB_ACTIONS_ISSUER,
  type EvidenceStatusDto,
} from "@/contracts/v1/evidence";
import { compileContracts } from "@/contracts/v1/shapes-engine";
import { withWorkspace } from "@/server/db/context";
import { applyRetention } from "@/server/maintenance/retention";
import { EvidenceError } from "@/server/modules/evidence/errors";
import {
  cleanRevision,
  ingestEvidence,
} from "@/server/modules/evidence/ingest";
import { jwksKeySource, type KeySource } from "@/server/modules/evidence/oidc";
import { withRuntime } from "@/server/db/runtime-context";
import {
  evidenceStatus,
  runtimeEvidenceStatus,
} from "@/server/modules/evidence/status";
import {
  createVerifier,
  revokeVerifier,
} from "@/server/modules/evidence/verifiers";
import { publishIntendedRevision } from "@/server/modules/inventory";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  inEachMode,
  issueToken,
  readerToken,
  useDatabase,
  type TestWorkspace,
} from "./world";
import { runMigrations } from "../../scripts/local-stack.mjs";
import {
  backendTestDatabase,
  revertMigrationsThrough,
  withScratchDatabase,
} from "../support/local-stack";

useDatabase();

const ORIGIN = "https://nodrail.test";
process.env.APP_ORIGIN = ORIGIN;

const SECRET = "ghp_never_store_this_secret";
const REPOSITORY_ID = "424242";
const WORKFLOW = "acme/ci/.github/workflows/evidence.yml@refs/heads/main";
const PROJECT_ID = "6d0f6c2e-1b9a-4e47-8a3e-0f4c2d1b7a55";
const REVISION = "7".repeat(64);

const compiled = compileContracts({
  manifest: {
    shapes: {
      "ci-result": {
        properties: {
          status: { values: ["passed", "failed"], report: true },
          tests: { type: "integer", min: 0, report: true },
          token: { type: "string", max: 100, classification: "secret" },
        },
      },
      "ci-result-v2": {
        properties: {
          status: { values: ["passed", "failed", "skipped"], report: true },
        },
      },
    },
  },
  resources: [],
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.issues));
const ciResult = compiled.contracts!.shapes["ci-result"]!;
const otherContract = compiled.contracts!.shapes["ci-result-v2"]!.contract;

// ── A local OIDC issuer: its own key pair and JWKS, served over HTTP ──────

const issuer = generateKeyPairSync("rsa", { modulusLength: 2048 });
const forger = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
let server: Server;
let keys: KeySource;

beforeAll(async () => {
  const jwk = { ...issuer.publicKey.export({ format: "jwk" }), kid: KID };
  server = createServer((_, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  keys = jwksKeySource(`http://127.0.0.1:${port}/jwks`);
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt(
  claims: Record<string, unknown>,
  options: { key?: KeyObject; header?: Record<string, unknown> } = {},
) {
  const head = b64(options.header ?? { alg: "RS256", kid: KID, typ: "JWT" });
  const body = b64(claims);
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${head}.${body}`),
    options.key ?? issuer.privateKey,
  ).toString("base64url");
  return `${head}.${body}.${signature}`;
}

const now = () => Math.floor(Date.now() / 1000);
const hex = (bytes: number) => randomBytes(bytes).toString("hex");

type Run = { sha: string; runId: string; workspace: string };

const claimsFor = (run: Run, overrides: Record<string, unknown> = {}) => ({
  iss: GITHUB_ACTIONS_ISSUER,
  aud: `${ORIGIN}/w/${run.workspace}`,
  exp: now() + 300,
  iat: now(),
  nbf: now(),
  jti: randomUUID(),
  sha: run.sha,
  ref: "refs/heads/main",
  repository: "acme/ci",
  repository_id: REPOSITORY_ID,
  job_workflow_ref: WORKFLOW,
  run_id: run.runId,
  run_attempt: "1",
  event_name: "push",
  actor_id: "77",
  ...overrides,
});

const bodyFor = (run: Run, overrides: Record<string, unknown> = {}) => ({
  workspace: run.workspace,
  environment: "development",
  evidence: "ci-tests",
  commit: run.sha,
  contract: ciResult.contract,
  value: { status: "passed", tests: 12, token: SECRET },
  ...overrides,
});

const newRun = (w: TestWorkspace): Run => ({
  sha: hex(20),
  runId: String(Math.floor(Math.random() * 1e12)),
  workspace: w.id,
});

/** The rejection code, or "stored". */
async function outcome(promise: Promise<unknown>) {
  try {
    await promise;
    return "stored";
  } catch (error) {
    if (error instanceof EvidenceError) return error.code;
    throw error;
  }
}

/** A workspace with a verifier and a published revision gating on CI. */
async function trusted() {
  const w = await createWorkspace();
  const verifier = await withWorkspace(w.owner, w.id, (context) =>
    createVerifier(context, {
      name: "github-actions",
      repository_id: REPOSITORY_ID,
      repository: "acme/ci",
      job_workflow_ref: WORKFLOW,
      allowed_refs: ["refs/heads/*", "refs/tags/v*"],
      environments: ["development"],
    }),
  );
  await withWorkspace(w.owner, w.id, (context) =>
    publishIntendedRevision(context, "development", {
      project_id: PROJECT_ID,
      project: "shop",
      revision: REVISION,
      files: [],
      contracts: {
        revisions: [
          {
            digest: ciResult.contract,
            name: "ci-result",
            surface: "evidence",
            dialect: 1,
            shape: ciResult.shape,
          },
        ],
        bindings: [
          {
            surface: "evidence",
            target: "evidence:ci-tests",
            contract_digest: ciResult.contract,
          },
        ],
      },
      evidence: {
        bindings: [
          {
            evidence: "ci-tests",
            contract_digest: ciResult.contract,
            verifiers: ["github-actions"],
            subject: "revision",
          },
        ],
        requirements: [
          {
            gate: "merge",
            index: 0,
            evidence: "ci-tests",
            authority: "externally-verified",
            subject: "revision",
            where: [{ path: ["status"], op: "eq", value: "passed" }],
          },
        ],
      },
    }),
  );
  return { w, verifier };
}

const submit = (
  run: Run,
  claims: Record<string, unknown> = {},
  body: Record<string, unknown> = {},
) => ingestEvidence(jwt(claimsFor(run, claims)), bodyFor(run, body), keys);

const status = (
  w: TestWorkspace,
  query: Record<string, unknown>,
): Promise<EvidenceStatusDto> =>
  withWorkspace(w.owner, w.id, (context) =>
    evidenceStatus(context, {
      workspace_revision: REVISION,
      gate: "merge",
      requirement: "0",
      ...query,
    }),
  );

inEachMode(() => {
  let w: TestWorkspace;
  let verifierId: string;
  beforeAll(async () => {
    const setup = await trusted();
    w = setup.w;
    verifierId = setup.verifier.id;
  });

  describe("ingestion", () => {
    test("stores verified evidence bound to the clean revision of the commit", async () => {
      const run = newRun(w);
      const stored = await submit(run);
      expect(stored).toMatchObject({
        evidence: "ci-tests",
        subject: cleanRevision(run.sha),
        contract: ciResult.contract,
        validation: "valid",
        replayed: false,
      });
      const [row] = await admin.query(
        `SELECT authority, producer_class, subject_source, validated_by,
                installation_id, verifier_id, payload, authorized_value,
                provenance, redacted
         FROM nodrail.contract_events WHERE id = $1`,
        [stored.id],
      );
      expect(row).toMatchObject({
        authority: "authoritative",
        producer_class: "externally-verified",
        subject_source: "externally-verified",
        validated_by: "server",
        installation_id: null,
        verifier_id: verifierId,
        payload: { status: "passed", tests: 12 },
        authorized_value: { status: "passed", tests: 12 },
      });
      expect(row.provenance).toMatchObject({
        run_id: run.runId,
        repository: "acme/ci",
        ref: "refs/heads/main",
      });
      // The secret path is never stored, anywhere on the row.
      expect(JSON.stringify(row)).not.toContain(SECRET);
      expect(row.redacted).toContain("token");
    });

    test("cleanRevision is the engine's workRevision formula for a clean tree", () => {
      // HEAD's line, an empty diff and an empty untracked list, each length-prefixed.
      const sha = "a".repeat(40);
      expect(cleanRevision(sha)).toBe(
        `sha256:${createHash("sha256")
          .update(`41\n${sha}\n0\n0\n`)
          .digest("hex")}`,
      );
    });

    test("refuses forged audience, issuer, repository, workflow and signature", async () => {
      const run = newRun(w);
      expect(
        await outcome(submit(run, { aud: `https://evil.test/w/${w.id}` })),
      ).toBe("audience-mismatch");
      expect(
        await outcome(submit(run, { aud: [`${ORIGIN}/w/${w.id}`, "other"] })),
      ).toBe("audience-mismatch");
      expect(
        await outcome(submit(run, { iss: "https://issuer.evil.test" })),
      ).toBe("token-invalid");
      expect(await outcome(submit(run, { repository_id: "999" }))).toBe(
        "verifier-unknown",
      );
      expect(
        await outcome(
          submit(run, {
            job_workflow_ref:
              "acme/ci/.github/workflows/evidence.yml@refs/heads/feature",
          }),
        ),
      ).toBe("verifier-unknown");
      expect(
        await outcome(
          ingestEvidence(
            jwt(claimsFor(run), { key: forger.privateKey }),
            bodyFor(run),
            keys,
          ),
        ),
      ).toBe("token-invalid");
      expect(
        await outcome(
          ingestEvidence(
            jwt(claimsFor(run), { header: { alg: "none", kid: KID } }),
            bodyFor(run),
            keys,
          ),
        ),
      ).toBe("token-invalid");
      expect(
        await outcome(
          ingestEvidence(
            jwt(claimsFor(run), { header: { alg: "RS256", kid: "unknown" } }),
            bodyFor(run),
            keys,
          ),
        ),
      ).toBe("token-invalid");
    });

    test("refuses expired and stale tokens", async () => {
      const run = newRun(w);
      expect(
        await outcome(submit(run, { exp: now() - 120, iat: now() - 400 })),
      ).toBe("token-invalid");
      expect(
        await outcome(submit(run, { iat: now() - 2000, exp: now() + 300 })),
      ).toBe("token-invalid");
      expect(await outcome(submit(run, { nbf: now() + 600 }))).toBe(
        "token-invalid",
      );
    });

    test("refuses a ref, environment, event or commit the verifier doesn't cover", async () => {
      const run = newRun(w);
      expect(await outcome(submit(run, { ref: "refs/pull/7/merge" }))).toBe(
        "ref-not-allowed",
      );
      expect(
        await outcome(submit(run, {}, { environment: "production" })),
      ).toBe("environment-not-allowed");
      expect(await outcome(submit(run, { event_name: "pull_request" }))).toBe(
        "event-unsupported",
      );
      expect(await outcome(submit(run, {}, { commit: hex(20) }))).toBe(
        "subject-mismatch",
      );
      expect(await outcome(submit(run, {}, { evidence: "lint" }))).toBe(
        "producer-not-allowed",
      );
      expect(await outcome(submit(run, {}, { surprise: true }))).toBe(
        "invalid-input",
      );
    });

    test("refuses a contract other than the published one", async () => {
      const run = newRun(w);
      expect(await outcome(submit(run, {}, { contract: otherContract }))).toBe(
        "contract-mismatch",
      );
    });

    test("an identical retry answers the stored event; a replayed jti with another body is refused", async () => {
      const run = newRun(w);
      const claims = claimsFor(run);
      const token = jwt(claims);
      const first = await ingestEvidence(token, bodyFor(run), keys);
      const again = await ingestEvidence(token, bodyFor(run), keys);
      expect(again).toMatchObject({ id: first.id, replayed: true });
      // A new token for the same run and attempt, same body: still one event.
      const retried = await submit(run);
      expect(retried).toMatchObject({ id: first.id, replayed: true });
      expect(
        await outcome(
          ingestEvidence(
            token,
            bodyFor(run, { value: { status: "failed", tests: 3, token: "x" } }),
            keys,
          ),
        ),
      ).toBe("token-replayed");
      const [{ count }] = await admin.query(
        `SELECT count(*)::int AS count FROM nodrail.contract_events
         WHERE workspace_id = $1 AND provenance->>'run_id' = $2`,
        [w.id, run.runId],
      );
      expect(count).toBe(1);
    });

    test("another body for the same run, attempt and key is a conflict", async () => {
      const run = newRun(w);
      await submit(run);
      expect(
        await outcome(
          submit(
            run,
            {},
            { value: { status: "failed", tests: 1, token: "x" } },
          ),
        ),
      ).toBe("event-conflict");
      // Another key is another event.
      expect(await outcome(submit(run, {}, { event_key: "shard-2" }))).toBe(
        "stored",
      );
    });

    test("an invalid value is stored as invalid, with no value kept", async () => {
      const run = newRun(w);
      const stored = await submit(run, {}, { value: { status: "maybe" } });
      expect(stored.validation).toBe("invalid");
      const [row] = await admin.query(
        "SELECT payload, authorized_value FROM nodrail.contract_events WHERE id = $1",
        [stored.id],
      );
      expect(row).toEqual({ payload: {}, authorized_value: null });
    });

    test("a token for another workspace never reaches this one", async () => {
      const other = await createWorkspace();
      const run = newRun(w);
      // Signed for the other workspace, sent for this one.
      expect(
        await outcome(submit(run, { aud: `${ORIGIN}/w/${other.id}` })),
      ).toBe("audience-mismatch");
      // Signed for the other workspace and sent there: its verifiers only.
      const there = { ...run, workspace: other.id };
      expect(await outcome(submit(there))).toBe("verifier-unknown");
    });
  });

  describe("status of a published requirement", () => {
    test("met for the subject CI verified, unmet for any other", async () => {
      const run = newRun(w);
      const stored = await submit(run);
      expect(
        await status(w, { subject: cleanRevision(run.sha) }),
      ).toMatchObject({
        met: true,
        reason_code: "met",
        event_id: stored.id,
        verifier: { name: "github-actions", revoked_at: null },
      });
      expect(
        await status(w, { subject: cleanRevision(hex(20)) }),
      ).toMatchObject({ met: false, reason_code: "no_event" });
    });

    test("a host's own credential reads the same status, for its environment only", async () => {
      const run = newRun(w);
      await submit(run);
      const subject = cleanRevision(run.sha);
      const token = await issueToken(
        w,
        await createAgent(w, `host-${randomUUID().slice(0, 8)}`),
      );
      const viaHost = (query: Record<string, unknown>) =>
        withRuntime(token, "evidence:read", (context) =>
          runtimeEvidenceStatus(context, {
            workspace_revision: REVISION,
            gate: "merge",
            requirement: "0",
            ...query,
          }),
        );
      expect(await viaHost({ subject })).toEqual(await status(w, { subject }));
      // The credential's environment is the only one it may ask about.
      await expect(
        viaHost({ subject, environment: "development" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    });

    test("a credential without evidence:read is refused", async () => {
      const token = await issueToken(
        w,
        await createAgent(w, `host-${randomUUID().slice(0, 8)}`),
      );
      await admin.query(
        `UPDATE nodrail.installation_credentials
         SET scopes = array_remove(scopes, 'evidence:read')
         WHERE public_prefix = $1`,
        [token.split("_")[1]],
      );
      await expect(
        withRuntime(token, "evidence:read", (context) =>
          runtimeEvidenceStatus(context, {
            workspace_revision: REVISION,
            gate: "merge",
            requirement: "0",
            subject: cleanRevision(hex(20)),
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    test("the last received event decides: a failing re-run closes the gate", async () => {
      const sha = hex(20);
      await submit({ ...newRun(w), sha });
      await submit(
        { ...newRun(w), sha },
        {},
        { value: { status: "failed", tests: 12, token: "x" } },
      );
      expect(await status(w, { subject: cleanRevision(sha) })).toMatchObject({
        met: false,
        reason_code: "where_unmet",
      });
    });

    test("a reported or installation row never satisfies", async () => {
      const sha = hex(20);
      const subject = cleanRevision(sha);
      const agent = await createAgent(w, "ci-bot");
      const base = {
        workspace_id: w.id,
        environment_id: w.environmentId,
        surface: "evidence",
        contract_name: "ci-result",
        contract_digest: ciResult.contract,
        projection_digest: ciResult.projection.digest,
        subject_revision: subject,
        capture: "captured",
        validation: "valid",
        projection_validation: "valid",
        payload: { status: "passed" },
        occurred_at: new Date(),
      };
      await admin.query(
        `INSERT INTO nodrail.contract_events
           (workspace_id, environment_id, authority, producer_class, surface,
            contract_name, contract_digest, projection_digest, user_id,
            trace_id, span_id, project, host, subject_revision, subject_source,
            capture, validation, validated_by, projection_validation, payload,
            occurred_at)
         VALUES ($1, $2, 'reported', 'runtime-observed', $3, $4, $5, $6, $7,
                 $8, $9, 'shop', 'claude', $10, 'runtime-observed', $11, $12,
                 'producer', $13, $14, $15)`,
        [
          base.workspace_id,
          base.environment_id,
          base.surface,
          base.contract_name,
          base.contract_digest,
          base.projection_digest,
          w.owner.userId,
          hex(16),
          hex(8),
          subject,
          base.capture,
          base.validation,
          base.projection_validation,
          base.payload,
          base.occurred_at,
        ],
      );
      await admin.query(
        `INSERT INTO nodrail.contract_events
           (workspace_id, environment_id, authority, producer_class, surface,
            contract_name, contract_digest, projection_digest, installation_id,
            idempotency_key, subject_revision, subject_source, capture,
            validation, validated_by, projection_validation, payload,
            occurred_at)
         VALUES ($1, $2, 'authoritative', 'runtime-observed', $3, $4, $5, $6,
                 $7, $8, $9, 'runtime-observed', $10, $11, 'server', $12, $13,
                 $14)`,
        [
          base.workspace_id,
          base.environment_id,
          base.surface,
          base.contract_name,
          base.contract_digest,
          base.projection_digest,
          agent.installationId,
          randomUUID(),
          subject,
          base.capture,
          base.validation,
          base.projection_validation,
          base.payload,
          base.occurred_at,
        ],
      );
      expect(await status(w, { subject })).toMatchObject({
        met: false,
        reason_code: "no_event",
      });
      // Nor can a reported row be stored as a verifier's.
      await expect(
        admin.query(
          `UPDATE nodrail.contract_events SET verifier_id = $1, evidence = 'ci-tests'
           WHERE workspace_id = $2 AND authority = 'reported'`,
          [verifierId, w.id],
        ),
      ).rejects.toThrow(/contract_events_source/);
    });

    test("refuses an unpublished revision, an unknown requirement and client conditions", async () => {
      const subject = cleanRevision(hex(20));
      await expect(
        status(w, { subject, workspace_revision: "8".repeat(64) }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        status(w, { subject, requirement: "1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        status(w, { subject, where: "status=passed" }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });

      const token = await readerToken(w);
      const ask = (query: string) =>
        statusRoute.GET(
          new NextRequest(`${ORIGIN}/api/v1/evidence/status?${query}`, {
            headers: { authorization: `Bearer ${token}` },
          }),
          { params: Promise.resolve({}) },
        );
      const base = `workspace_revision=${REVISION}&gate=merge&requirement=0&subject=${subject}`;
      expect((await ask(base)).status).toBe(200);
      expect(await (await ask(base)).json()).toMatchObject({
        met: false,
        reason_code: "no_event",
      });
      expect((await ask(`${base}&path=status&value=passed`)).status).toBe(422);
      expect((await ask(base.replace(REVISION, "9".repeat(64)))).status).toBe(
        404,
      );
    });

    test("revoking the verifier takes back its evidence, past and future", async () => {
      const { w: v, verifier } = await trusted();
      const run = newRun(v);
      await submit(run);
      const subject = cleanRevision(run.sha);
      expect((await status(v, { subject })).met).toBe(true);
      await withWorkspace(v.owner, v.id, (context) =>
        revokeVerifier(context, verifier.id),
      );
      expect(await status(v, { subject })).toMatchObject({
        met: false,
        reason_code: "verifier_revoked",
      });
      // And it can't submit any more.
      expect(await outcome(submit(newRun(v)))).toBe("verifier-unknown");
    });
  });

  describe("verifiers", () => {
    test("only an admin adds or revokes one; an active name is unique", async () => {
      const manager = await addMember(w, "policy_manager");
      const input = {
        name: "release",
        repository_id: REPOSITORY_ID,
        repository: "acme/ci",
        job_workflow_ref: WORKFLOW,
        environments: ["development"],
      };
      await expect(
        withWorkspace(manager, w.id, (context) =>
          createVerifier(context, input),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const created = await withWorkspace(w.owner, w.id, (context) =>
        createVerifier(context, input),
      );
      expect(created.audience).toBe(`${ORIGIN}/w/${w.id}`);
      await expect(
        withWorkspace(w.owner, w.id, (context) =>
          createVerifier(context, input),
        ),
      ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
      await withWorkspace(w.owner, w.id, (context) =>
        revokeVerifier(context, created.id),
      );
      await expect(
        withWorkspace(w.owner, w.id, (context) =>
          createVerifier(context, input),
        ),
      ).resolves.toMatchObject({ name: "release", revokedAt: null });
    });
  });

  describe("route", () => {
    const post = (body: string, headers: Record<string, string>) =>
      evidenceRoute.POST(
        new NextRequest(`${ORIGIN}/api/v1/evidence`, {
          method: "POST",
          body,
          headers: { "content-type": "application/json", ...headers },
        }),
      );

    test("answers refusals with their code", async () => {
      const missing = await post("{}", {});
      expect(missing.status).toBe(401);
      expect(await missing.json()).toMatchObject({
        error: { code: "token-invalid" },
      });
      const big = await post(JSON.stringify({ value: "x".repeat(20_000) }), {
        authorization: "Bearer a.b.c",
      });
      expect(big.status).toBe(413);
      const garbage = await post("{}", { authorization: "Bearer not-a-jwt" });
      expect(garbage.status).toBe(401);
    });
  });

  describe("read role", () => {
    test("can't select the evaluator's values", async () => {
      const [row] = await admin.query(
        `SELECT has_column_privilege('nodrail_member_read', 'nodrail.contract_events', 'authorized_value', 'SELECT') AS value,
                has_column_privilege('nodrail_member_read', 'nodrail.contract_events', 'body_digest', 'SELECT') AS digest,
                has_column_privilege('nodrail_member_read', 'nodrail.contract_events', 'payload', 'SELECT') AS payload`,
      );
      expect(row).toEqual({ value: false, digest: false, payload: true });
    });
  });

  describe("retention", () => {
    test("forgets token uses a day after they expire", async () => {
      const run = newRun(w);
      const claims = claimsFor(run);
      await ingestEvidence(jwt(claims), bodyFor(run), keys);
      await admin.query(
        `UPDATE nodrail.evidence_token_uses
         SET expires_at = now() - interval '2 days' WHERE jti = $1`,
        [claims.jti],
      );
      await applyRetention();
      const rows = await admin.query(
        "SELECT 1 FROM nodrail.evidence_token_uses WHERE jti = $1",
        [claims.jti],
      );
      expect(rows).toHaveLength(0);
    });
  });
});

describe("migration", () => {
  /** An installation's event and a verifier's, written past keys and row security. */
  async function seed(url: string) {
    const client = new Client({ connectionString: url });
    await client.connect();
    const [w, e, i, v, u] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const digest = `sha256:${"a".repeat(64)}`;
    try {
      await client.query("SET session_replication_role = replica");
      await client.query(
        `INSERT INTO nodrail.evidence_verifiers
           (id, workspace_id, name, environment_ids, repository_id, repository,
            job_workflow_ref, created_by)
         VALUES ($1, $2, 'github-actions', ARRAY[$3]::uuid[], '1', 'acme/ci',
                 'acme/ci/.github/workflows/e.yml@refs/heads/main', $4)`,
        [v, w, e, u],
      );
      const event = `INSERT INTO nodrail.contract_events
           (workspace_id, environment_id, authority, producer_class, surface,
            contract_name, contract_digest, projection_digest, installation_id,
            verifier_id, evidence, provenance, body_digest, idempotency_key,
            capture, validation, validated_by, projection_validation,
            subject_revision, subject_source, occurred_at)
         VALUES ($1, $2, 'authoritative', $3, 'evidence', 'ci-result', $4, $4,
                 $5, $6, $7, $8, $9, $10, 'captured', 'valid', 'server',
                 'valid', $4, $11, now())`;
      await client.query(event, [
        w,
        e,
        "runtime-observed",
        digest,
        i,
        null,
        null,
        null,
        null,
        "k1",
        "runtime-observed",
      ]);
      await client.query(event, [
        w,
        e,
        "externally-verified",
        digest,
        null,
        v,
        "ci-tests",
        {},
        digest,
        "k2",
        "externally-verified",
      ]);
    } finally {
      await client.end();
    }
  }

  async function inspect(url: string) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      const { rows: tables } = await client.query(
        `SELECT count(*)::int AS n FROM pg_tables
         WHERE schemaname = 'nodrail' AND tablename LIKE 'evidence_%'`,
      );
      const { rows: events } = await client.query(
        `SELECT idempotency_key FROM nodrail.contract_events ORDER BY idempotency_key`,
      );
      const { rows: grants } = await client.query(
        `SELECT has_table_privilege('nodrail_member_read', 'nodrail.contract_events', 'SELECT') AS whole`,
      );
      return {
        tables: tables[0].n,
        events: events.map((row) => row.idempotency_key),
        whole: grants[0].whole,
      };
    } finally {
      await client.end();
    }
  }

  test(
    "goes down and up again on seeded data",
    () =>
      withScratchDatabase(
        `${backendTestDatabase().database}_evidence_updown`,
        async (urls) => {
          await seed(urls.admin);
          expect(await inspect(urls.admin)).toEqual({
            tables: 4,
            events: ["k1", "k2"],
            whole: false,
          });
          revertMigrationsThrough(urls.owner, "EvidenceVerifiers");
          // A verifier's event can't outlive the columns that mark it.
          expect(await inspect(urls.admin)).toEqual({
            tables: 0,
            events: ["k1"],
            whole: true,
          });
          runMigrations(urls.owner);
          expect(await inspect(urls.admin)).toEqual({
            tables: 4,
            events: ["k1"],
            whole: false,
          });
        },
      ),
    120_000,
  );
});
