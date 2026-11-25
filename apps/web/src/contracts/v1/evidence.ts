import { z } from "zod";
import { contractDigest } from "./declared-contracts";
import { compiledCondition } from "./shapes-engine";

/**
 * Evidence from verifiers: the wire
 * contract of `POST /api/v1/evidence`, which a CI job calls with its GitHub
 * Actions OIDC token, of `GET /api/v1/evidence/status`, which a local hook
 * asks about one published gate requirement, of the verifiers an admin
 * configures and of what `workspace publish` adds about evidence.
 *
 * Cloud accepts only externally-verified evidence: a CI job proves
 * who it is with a token GitHub signed, never with a URL or a provider name
 * in the body, and an installation never submits evidence here.
 */

// ── Limits ─────────────────────────────────────────────────────────────────

/** A submitted body, value included; past it the server answers 413. */
export const MAX_EVIDENCE_BODY_BYTES = 16 * 1024;
/** Verifiers listed per evidence binding, as the grammar allows producers. */
export const MAX_BINDING_VERIFIERS = 10;
/** Requirements one gate may have, and so the highest index asked about. */
export const MAX_GATE_REQUIREMENTS = 20;
/** Evidence bindings and requirements one published revision may pin. */
export const MAX_EVIDENCE_PINS = 500;
/** How long a token may have been issued before it is used. */
export const TOKEN_MAX_AGE_SECONDS = 600;
/** Clock skew allowed on `exp`, `iat` and `nbf`. */
export const TOKEN_CLOCK_SKEW_SECONDS = 60;
/** The only issuer a `github-actions` verifier trusts. */
export const GITHUB_ACTIONS_ISSUER =
  "https://token.actions.githubusercontent.com";

// ── Names ──────────────────────────────────────────────────────────────────

/** An evidence binding's name, as the grammar spells it (`ci-tests`). */
export const evidenceName = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
/** A verifier's name, as an evidence binding's producer names it. */
export const verifierName = evidenceName;
/** A commit: SHA-1 or SHA-256 object names, lowercase. */
export const commitSha = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
/** The work's revision, as `workRevision` and `cleanRevision` give it. */
export const subjectDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** A published workspace revision: the lock's digest. */
export const workspaceRevision = z.string().regex(/^[0-9a-f]{64}$/);
const environmentSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);

// ── Submission ─────────────────────────────────────────────────────────────

/**
 * What a CI job sends, with `Authorization: Bearer <GitHub OIDC JWT>`.
 * The token's `aud` names the workspace (`<origin>/w/<workspace>`), which
 * must be this one; `commit` must be the token's `sha`. Nothing here says
 * who produced it: the token does.
 */
export const evidenceSubmitInput = z
  .object({
    workspace: z.uuid(),
    environment: environmentSlug,
    evidence: evidenceName,
    /** Tells apart several events of one evidence in one job run. */
    event_key: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .default("default"),
    commit: commitSha,
    /** The contract digest the job validated against; must be the published one. */
    contract: contractDigest,
    value: z.record(z.string(), z.unknown()),
  })
  .strict();
export type EvidenceSubmitInput = z.infer<typeof evidenceSubmitInput>;

/** Why a submission was refused: one code each, never a value. */
export const evidenceRejections = {
  /** Not JSON, or not the shape above. */
  "invalid-input": 422,
  /** Over {@link MAX_EVIDENCE_BODY_BYTES}. */
  "too-large": 413,
  /** No token, a bad signature, another issuer, expired or too old. */
  "token-invalid": 401,
  /** The token's `aud` isn't this deployment's URL for the body's workspace. */
  "audience-mismatch": 403,
  /** No active verifier has the token's repository and exact workflow. */
  "verifier-unknown": 403,
  /** The run's `ref` doesn't match the verifier's allowed refs. */
  "ref-not-allowed": 403,
  /** The verifier may not submit to that environment. */
  "environment-not-allowed": 403,
  /** No intended revision binds that evidence to this verifier. */
  "producer-not-allowed": 403,
  /** A `pull_request` run: its commit is a merge commit. */
  "event-unsupported": 422,
  /** `commit` isn't the token's `sha`. */
  "subject-mismatch": 422,
  /** The body's contract isn't the one the intended revision published. */
  "contract-mismatch": 409,
  /** This token was already used with another body. */
  "token-replayed": 409,
  /** This run, attempt, evidence and key already stored another body. */
  "event-conflict": 409,
  /** GitHub's signing keys couldn't be read; try again. */
  "verifier-unavailable": 503,
} as const;
export type EvidenceRejection = keyof typeof evidenceRejections;

/** What a stored, or retried, submission answers. */
export type EvidenceStoredDto = {
  id: string;
  evidence: string;
  /** `cleanRevision(commit)`: the work at that commit, clean. */
  subject: string;
  contract: string;
  validation: "valid" | "invalid";
  /** Declared paths and codes only, never a value. */
  issues: { path: string | null; code: string }[];
  issue_count: number;
  received_at: string;
  /** True when this answered a retry of an event already stored. */
  replayed: boolean;
};

// ── Status (a local gate asking about an externally-verified requirement) ──

/**
 * A requirement by where the published revision compiled it: its gate and
 * index. Strict, so a caller can't send a condition of its own and use the
 * answer to learn a value the projection withholds.
 */
export const evidenceStatusQuery = z
  .object({
    workspace_revision: workspaceRevision,
    gate: z.string().min(1).max(200),
    requirement: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAX_GATE_REQUIREMENTS - 1),
    subject: subjectDigest,
    /** Only evidence submitted to this environment; any it is published to otherwise. */
    environment: environmentSlug.optional(),
  })
  .strict();
export type EvidenceStatusQuery = z.infer<typeof evidenceStatusQuery>;

/** Why a requirement is met or not, first failure first (WAVE3 §2). */
export const evidenceReasons = [
  "met",
  "subject_unknown",
  "no_event",
  "authority",
  "producer_not_allowed",
  "verifier_revoked",
  "contract_mismatch",
  "invalid",
  "where_unmet",
] as const;
export type EvidenceReason = (typeof evidenceReasons)[number];

export type EvidenceStatusDto = {
  met: boolean;
  reason_code: EvidenceReason;
  /** The event that decided, if one did. */
  event_id: string | null;
  verifier: { name: string; revoked_at: string | null } | null;
  received_at: string | null;
};

// ── Verifiers ──────────────────────────────────────────────────────────────

/** A ref glob: `*` within one path part, `**` across parts. */
const refGlob = z.string().regex(/^refs\/[A-Za-z0-9._/*-]{1,200}$/);

export const createVerifierInput = z
  .object({
    name: verifierName,
    /** GitHub's numeric repository id (`repository_id` in the token). */
    repository_id: z.string().regex(/^[1-9][0-9]{0,19}$/),
    repository: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/),
    /** Exact: `owner/repo/.github/workflows/file.yml@refs/heads/main`. */
    job_workflow_ref: z
      .string()
      .min(3)
      .max(500)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[^@\s]+@refs\/[^\s]+$/),
    allowed_refs: z.array(refGlob).max(20).default([]),
    /** Environment slugs; at least one. */
    environments: z.array(environmentSlug).min(1).max(20),
  })
  .strict();
export type CreateVerifierInput = z.infer<typeof createVerifierInput>;

export type VerifierDto = {
  id: string;
  name: string;
  kind: "github-actions";
  repositoryId: string;
  repository: string;
  jobWorkflowRef: string;
  allowedRefs: string[];
  environments: string[];
  /** The `aud` its workflow requests a token for. */
  audience: string;
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;
};

// ── Publish (what `workspace publish` adds about evidence) ────────────────

/** One evidence binding: its contract and the verifiers its producers name. */
export const evidenceBindingPin = z
  .object({
    evidence: evidenceName,
    contract_digest: contractDigest,
    verifiers: z
      .array(verifierName)
      .max(MAX_BINDING_VERIFIERS)
      .refine((names) => new Set(names).size === names.length, "each once"),
    subject: z.enum(["revision", "none"]),
  })
  .strict();

/** One compiled gate requirement on evidence: v1 always on the revision. */
export const evidenceRequirementPin = z
  .object({
    gate: z.string().min(1).max(200),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_GATE_REQUIREMENTS - 1),
    evidence: evidenceName,
    authority: z.enum([
      "agent-reported",
      "runtime-observed",
      "externally-verified",
    ]),
    subject: z.literal("revision"),
    where: z.array(compiledCondition).max(20).default([]),
  })
  .strict();

/**
 * Optional in a publish body, so older clients publish as before. Every
 * requirement names evidence the same body binds.
 */
export const evidenceClosureInput = z
  .object({
    bindings: z.array(evidenceBindingPin).max(MAX_EVIDENCE_PINS),
    requirements: z.array(evidenceRequirementPin).max(MAX_EVIDENCE_PINS),
  })
  .strict()
  .superRefine((closure, context) => {
    const bound = new Set(closure.bindings.map((b) => b.evidence));
    if (bound.size !== closure.bindings.length)
      context.addIssue({
        code: "custom",
        path: ["bindings"],
        message: "each evidence once",
      });
    const seen = new Set<string>();
    closure.requirements.forEach((requirement, index) => {
      const key = `${requirement.gate}\n${requirement.index}`;
      if (!bound.has(requirement.evidence) || seen.has(key))
        context.addIssue({
          code: "custom",
          path: ["requirements", index],
          message: "a bound evidence, each requirement once",
        });
      seen.add(key);
    });
  });
export type EvidenceClosureInput = z.infer<typeof evidenceClosureInput>;
