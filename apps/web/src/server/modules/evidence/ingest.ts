import "server-only";
import { createHash } from "node:crypto";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import {
  evidenceSubmitInput,
  type EvidenceStoredDto,
  type EvidenceSubmitInput,
} from "@/contracts/v1/evidence";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import { validateValue } from "@/contracts/v1/shapes-engine";
import { asSystem, parseRows } from "@/server/db/context";
import {
  keptFrom,
  pinnedProjection,
} from "@/server/modules/contracts/authoritative";
import { unclassified } from "@/server/modules/contracts/runtime-receipts";
import { EvidenceError } from "./errors";
import {
  githubActionsKeys,
  refMatches,
  verifyActionsToken,
  type ActionsClaims,
  type KeySource,
} from "./oidc";
import { evidenceAudience } from "./verifiers";

/**
 * `POST /api/v1/evidence`: a CI job's evidence, authenticated by
 * its GitHub Actions OIDC token and bound to the exact commit it ran on.
 *
 * - The workspace comes from the token's audience; the verifier from the
 *   token's repository and exact workflow, looked up in that workspace only.
 * - The subject is computed here, `cleanRevision(claims.sha)`.
 * - The value is validated by the server against the contract the intended
 *   revision published; the event keeps its projection, and for the gate
 *   evaluator only, the valid value without classified paths.
 * - One event per (verifier, run, attempt, evidence, key) and one use per
 *   token, both bound to the body: the same body again answers the stored
 *   event, another body is refused. A replay never adds a row, so it can't
 *   make evidence look fresher.
 */

/**
 * The revision of a clean checkout at `commit`, as the engine's
 * `workRevision` reads it: HEAD, an empty diff and no untracked files, each
 * part length-prefixed. Equal to `workRevision` only on a clean tree at
 * exactly that commit. Kept here until the engine exports `cleanRevision`.
 */
export function cleanRevision(commit: string) {
  const hash = createHash("sha256");
  for (const part of [`${commit}\n`, "", ""])
    hash.update(`${Buffer.byteLength(part)}\n`).update(part);
  return `sha256:${hash.digest("hex")}`;
}

/** A merge commit isn't the head anyone works on. */
const UNSUPPORTED_EVENTS = new Set(["pull_request", "pull_request_target"]);

const verifierRow = z.object({
  id: z.string(),
  name: z.string(),
  environment_ids: z.array(z.string()),
  allowed_refs: z.array(z.string()),
});

const storedRow = z.object({
  id: z.string(),
  body_digest: z.string(),
  subject_revision: z.string(),
  contract_digest: z.string(),
  validation: z.enum(["valid", "invalid"]),
  issues: z.array(z.object({ path: z.string().nullable(), code: z.string() })),
  issue_count: z.number(),
  received_at: z.date(),
});
type Stored = z.infer<typeof storedRow>;

const toDto = (
  row: Stored,
  evidence: string,
  replayed: boolean,
): EvidenceStoredDto => ({
  id: row.id,
  evidence,
  subject: row.subject_revision,
  contract: row.contract_digest,
  validation: row.validation,
  issues: row.issues,
  issue_count: row.issue_count,
  received_at: row.received_at.toISOString(),
  replayed,
});

const STORED = `SELECT id, body_digest, subject_revision, contract_digest,
         validation, issues, issue_count, received_at
  FROM nodrail.contract_events`;

/** The token's single audience, which must name the body's workspace. */
function checkAudience(claims: ActionsClaims, workspaceId: string) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (audiences.length !== 1 || audiences[0] !== evidenceAudience(workspaceId))
    throw new EvidenceError("audience-mismatch");
}

type Scope = { manager: EntityManager; workspaceId: string };

/**
 * The verifier this token speaks for: active, its repository and exact
 * workflow, a ref it allows, the environment it may submit to, and named
 * by an evidence binding of the environment's intended revision.
 */
async function resolveVerifier(
  scope: Scope,
  claims: ActionsClaims,
  body: EvidenceSubmitInput,
) {
  const { manager, workspaceId } = scope;
  const candidates = parseRows(
    verifierRow,
    await manager.query(
      `SELECT v.id, v.name, v.environment_ids::text[] AS environment_ids,
              v.allowed_refs
       FROM nodrail.evidence_verifiers v
       JOIN nodrail.workspaces w ON w.id = v.workspace_id
       WHERE v.workspace_id = $1 AND v.repository_id = $2
         AND v.job_workflow_ref = $3 AND v.revoked_at IS NULL
         AND w.archived_at IS NULL
       ORDER BY v.name`,
      [workspaceId, claims.repository_id, claims.job_workflow_ref],
    ),
  );
  if (!candidates.length) throw new EvidenceError("verifier-unknown");
  const onRef = candidates.filter(
    (v) =>
      !v.allowed_refs.length ||
      v.allowed_refs.some((glob) => refMatches(glob, claims.ref)),
  );
  if (!onRef.length) throw new EvidenceError("ref-not-allowed");
  const [environment]: { id: string }[] = await manager.query(
    `SELECT id FROM nodrail.environments WHERE workspace_id = $1 AND slug = $2`,
    [workspaceId, body.environment],
  );
  const here = onRef.filter(
    (v) => environment && v.environment_ids.includes(environment.id),
  );
  if (!environment || !here.length)
    throw new EvidenceError("environment-not-allowed");
  const bindings: { contract_digest: string; verifiers: string[] }[] =
    await manager.query(
      `SELECT b.contract_digest, b.verifiers
       FROM nodrail.evidence_bindings b
       JOIN nodrail.intended_revisions i
         ON i.workspace_id = b.workspace_id
        AND i.environment_id = b.environment_id
        AND i.project_id = b.project_id AND i.revision = b.workspace_revision
       WHERE b.workspace_id = $1 AND b.environment_id = $2 AND b.evidence = $3`,
      [workspaceId, environment.id, body.evidence],
    );
  const verifier = here.find((v) =>
    bindings.some((b) => b.verifiers.includes(v.name)),
  );
  if (!verifier) throw new EvidenceError("producer-not-allowed");
  const allowed = bindings.filter((b) => b.verifiers.includes(verifier.name));
  if (!allowed.some((b) => b.contract_digest === body.contract))
    throw new EvidenceError("contract-mismatch");
  return { verifier, environmentId: environment.id };
}

/** The event a key already holds, if any. */
async function storedEvent(
  scope: Scope,
  where: { verifierId: string; key?: string; id?: string },
) {
  const [row] = parseRows(
    storedRow,
    await scope.manager.query(
      `${STORED}
       WHERE workspace_id = $1 AND verifier_id = $2
         AND ($3::text IS NULL OR idempotency_key = $3)
         AND ($4::uuid IS NULL OR id = $4)`,
      [
        scope.workspaceId,
        where.verifierId,
        where.key ?? null,
        where.id ?? null,
      ],
    ),
  );
  return row;
}

/** Records the token's one use; a different body under it is a replay. */
async function useToken(
  scope: Scope,
  use: {
    verifierId: string;
    jti: string;
    bodyDigest: string;
    eventId: string;
    expiresAt: number;
  },
) {
  const inserted: unknown[] = await scope.manager.query(
    `INSERT INTO nodrail.evidence_token_uses
       (workspace_id, verifier_id, jti, body_digest, event_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
     ON CONFLICT ON CONSTRAINT evidence_token_uses_once DO NOTHING
     RETURNING id`,
    [
      scope.workspaceId,
      use.verifierId,
      use.jti,
      use.bodyDigest,
      use.eventId,
      use.expiresAt,
    ],
  );
  if (inserted.length) return;
  const [earlier]: { body_digest: string }[] = await scope.manager.query(
    `SELECT body_digest FROM nodrail.evidence_token_uses
     WHERE workspace_id = $1 AND verifier_id = $2 AND jti = $3`,
    [scope.workspaceId, use.verifierId, use.jti],
  );
  if (earlier?.body_digest !== use.bodyDigest)
    throw new EvidenceError("token-replayed");
}

const revisionRow = z.object({ name: z.string(), schema: resolvedShape });

/** The token's non-secret claims, from which views build the run link. */
const provenanceOf = (claims: ActionsClaims, body: EvidenceSubmitInput) => ({
  repository: claims.repository,
  run_id: claims.run_id,
  run_attempt: claims.run_attempt,
  workflow_ref: claims.job_workflow_ref,
  ref: claims.ref,
  sha: claims.sha,
  event_name: claims.event_name,
  actor_id: claims.actor_id ?? null,
  event_key: body.event_key,
});

/** The value read by the server against the published contract. */
async function readValue(scope: Scope, body: EvidenceSubmitInput) {
  const [revision] = parseRows(
    revisionRow,
    await scope.manager.query(
      `SELECT name, schema FROM nodrail.contract_revisions
       WHERE workspace_id = $1 AND surface = 'evidence' AND digest = $2`,
      [scope.workspaceId, body.contract],
    ),
  );
  if (!revision) throw new EvidenceError("contract-mismatch");
  const issues = validateValue(revision.schema, body.value);
  const valid = issues.length === 0;
  const projection = await pinnedProjection(
    scope,
    "evidence",
    body.contract,
    revision.schema,
  );
  const kept = keptFrom(
    valid
      ? { state: "valid", value: body.value, findings: null }
      : { state: "invalid", issues },
    projection,
  );
  const authorized = valid
    ? unclassified(revision.schema.properties, body.value)
    : null;
  return { name: revision.name, kept, authorized };
}

/** Validates and keeps a new event; null when a concurrent one took the key. */
async function keepEvent(
  scope: Scope,
  input: {
    body: EvidenceSubmitInput;
    claims: ActionsClaims;
    verifierId: string;
    environmentId: string;
    key: string;
    bodyDigest: string;
  },
) {
  const { body, claims } = input;
  const { name, kept, authorized } = await readValue(scope, body);
  const [row] = parseRows(
    storedRow,
    await scope.manager.query(
      `INSERT INTO nodrail.contract_events
         (workspace_id, environment_id, authority, producer_class, surface,
          contract_name, contract_digest, projection_digest, verifier_id,
          evidence, idempotency_key, subject_revision, subject_source,
          capture, validation, validated_by, projection_validation, payload,
          redacted, issues, issue_count, authorized_value, provenance,
          body_digest, occurred_at)
       VALUES ($1, $2, 'authoritative', 'externally-verified', 'evidence',
               $3, $4, $5, $6, $7, $8, $9, 'externally-verified', 'captured',
               $10, 'server', $11, $12, $13, $14, $15, $16, $17, $18,
               clock_timestamp())
       ON CONFLICT ON CONSTRAINT contract_events_verified_once DO NOTHING
       RETURNING id, body_digest, subject_revision, contract_digest,
                 validation, issues, issue_count, received_at`,
      [
        scope.workspaceId,
        input.environmentId,
        name,
        body.contract,
        kept.projectionDigest,
        input.verifierId,
        body.evidence,
        input.key,
        cleanRevision(claims.sha),
        kept.validation,
        kept.projectionValidation,
        JSON.stringify(kept.payload),
        JSON.stringify(kept.redacted),
        JSON.stringify(kept.issues),
        kept.issueCount,
        authorized && JSON.stringify(authorized),
        JSON.stringify(provenanceOf(claims, body)),
        input.bodyDigest,
      ],
    ),
  );
  return row;
}

/**
 * Checks the token and the body, then stores the event or answers the one
 * this exact submission already stored.
 */
export async function ingestEvidence(
  token: string,
  rawBody: unknown,
  keys: KeySource = githubActionsKeys,
): Promise<EvidenceStoredDto> {
  const claims = await verifyActionsToken(token, keys);
  const parsed = evidenceSubmitInput.safeParse(rawBody);
  if (!parsed.success) throw new EvidenceError("invalid-input");
  const body = parsed.data;
  checkAudience(claims, body.workspace);
  if (UNSUPPORTED_EVENTS.has(claims.event_name))
    throw new EvidenceError("event-unsupported");
  if (body.commit !== claims.sha) throw new EvidenceError("subject-mismatch");
  const bodyDigest = fingerprint(body);
  const key = `gh:${createHash("sha256")
    .update(
      JSON.stringify([
        claims.run_id,
        claims.run_attempt,
        body.evidence,
        body.event_key,
      ]),
    )
    .digest("hex")}`;

  return asSystem(body.workspace, async (scope) => {
    const { verifier, environmentId } = await resolveVerifier(
      scope,
      claims,
      body,
    );
    const use = {
      verifierId: verifier.id,
      jti: claims.jti,
      bodyDigest,
      expiresAt: claims.exp,
    };
    const answer = async (row: Stored, replayed: boolean) => {
      if (row.body_digest !== bodyDigest)
        throw new EvidenceError("event-conflict");
      await useToken(scope, { ...use, eventId: row.id });
      return toDto(row, body.evidence, replayed);
    };
    // A token already used answers by its body, before anything else.
    const [used]: { body_digest: string; event_id: string }[] =
      await scope.manager.query(
        `SELECT body_digest, event_id FROM nodrail.evidence_token_uses
         WHERE workspace_id = $1 AND verifier_id = $2 AND jti = $3`,
        [scope.workspaceId, verifier.id, claims.jti],
      );
    if (used && used.body_digest !== bodyDigest)
      throw new EvidenceError("token-replayed");
    const earlier = await storedEvent(scope, {
      verifierId: verifier.id,
      ...(used ? { id: used.event_id } : { key }),
    });
    if (earlier) return answer(earlier, true);
    const kept = await keepEvent(scope, {
      body,
      claims,
      verifierId: verifier.id,
      environmentId,
      key,
      bodyDigest,
    });
    if (kept) return answer(kept, false);
    // Another request stored this key between the read and the insert.
    const raced = await storedEvent(scope, { verifierId: verifier.id, key });
    if (!raced) throw new EvidenceError("event-conflict");
    return answer(raced, true);
  });
}
