import type { JsonValue } from "@nodrail/sdk/protocol";
import { z } from "zod";
import {
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_STORED_ISSUES,
  contractDigest,
  contractName,
  contractSurfaces,
  issuePath,
  type ContractSurface,
  type SchemaAvailability,
} from "./declared-contracts";
import { boundedJson } from "./runtime";
import {
  CONTRACT_DIALECT,
  PAYLOAD_BYTES,
  PRODUCER_CLASSES,
  VERDICT_VALUE,
  type ProducerClass,
  type SurfaceId,
} from "./shapes-engine";

/**
 * Validated declared-contract events:
 * safe validation issues, provenance, and the reported and authoritative
 * ways an event comes in. See `declared-contracts.ts` for revisions.
 */

// ── Validation ─────────────────────────────────────────────────────────────

/**
 * Why a value failed, by code: the engine's value codes, then the receipt
 * reader's capture codes. A code an older Cloud doesn't know is kept as
 * `other`, never dropped.
 */
export const issueCodes = [
  "required",
  "unknown",
  "type",
  "enum",
  "too-short",
  "too-long",
  "too-few",
  "too-many",
  "below",
  "above",
  "duplicate",
  "parse",
  "not-final",
  "identity",
  "size",
  "other",
] as const;
export type IssueCode = (typeof issueCodes)[number];

/** The engine names an issue with the whole value `(value)`: no path to show. */
const ROOT_PATH = "(value)";

/**
 * A validation issue safe to store, show and export: where and why, never
 * the rejected value. Strict, so a `value`, `received` or message field is
 * refused rather than kept. The path is null when it names nothing the
 * projection discloses.
 */
export const safeValidationIssue = z
  .object({
    path: z.preprocess(
      (path) => (path === ROOT_PATH ? null : path),
      issuePath.nullable(),
    ),
    code: z.enum(issueCodes).catch("other"),
  })
  .strict();
export type SafeValidationIssue = z.infer<typeof safeValidationIssue>;

export const safeIssueList = z
  .array(safeValidationIssue)
  .max(MAX_STORED_ISSUES);

/** Whether the exchange was captured at all; distinct from its validity. */
export const captureStates = ["captured", "missing", "unsupported"] as const;
export type CaptureState = (typeof captureStates)[number];

export const validationStates = ["valid", "invalid"] as const;
export type ValidationState = (typeof validationStates)[number];

/** Whether the projected payload matched its projection schema. */
export const projectionStates = ["valid", "invalid"] as const;

// ── Provenance ─────────────────────────────────────────────────────────────

/** Where an event came in: a local report, or the Cloud runtime path. */
export const authorities = ["reported", "authoritative"] as const;
export type Authority = (typeof authorities)[number];

/**
 * Who stands behind the values, as the engine names them: agent-reported <
 * runtime-observed < externally-verified, and person-authenticated apart
 * (a person signed in to Cloud; it never stands in for the others). A local
 * report can only be one of the first two.
 */
export const producerClasses = PRODUCER_CLASSES;
export type { ProducerClass };

/** Who checked the full contract: the installation (claimed) or Cloud. */
export const validators = ["producer", "server"] as const;

/** Allowed combinations; the database enforces the same. */
export const reportedProducerClasses = [
  "agent-reported",
  "runtime-observed",
] as const satisfies readonly ProducerClass[];

/**
 * A subject revision as the runtime observed it: a commit (SHA-1 or
 * SHA-256 hex), or an engine digest of an action or file.
 */
export const subjectRevision = z
  .string()
  .regex(
    /^([0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$/,
    "a commit or digest",
  );

/**
 * The envelope the runtime or server owns. No receipt property can set or
 * override any of it: agent identity, run, step, subject and times.
 */
export type EventProvenanceDto =
  | {
      authority: "reported";
      producerClass: (typeof reportedProducerClasses)[number];
      /** Always the local-source label. */
      sourceLabel: string;
      person: string;
      mine: boolean;
      /** The machine's random id, as reported; not attestation. */
      machine: string | null;
      project: string;
      projectBound: boolean;
      host: string;
      agent: string | null;
      run: string | null;
      step: string | null;
      subject: { revision: string; source: "runtime-observed" } | null;
      occurredAt: string;
      receivedAt: string;
    }
  | {
      authority: "authoritative";
      producerClass: ProducerClass;
      /** Always the Cloud-managed label. */
      sourceLabel: string;
      installation: string;
      agent: string | null;
      runId: string | null;
      step: string | null;
      /** The exact action this event is bound to, when it is. */
      actionDigest: string | null;
      subject: {
        revision: string;
        source: "runtime-observed" | "externally-verified";
      } | null;
      occurredAt: string;
      receivedAt: string;
    };

// ── Events ─────────────────────────────────────────────────────────────────

/**
 * What a mediated provider call did, apart from whether its result
 * conformed: `not-called` when the call never reached the provider (an
 * invalid input, a denial). An invalid result never means the side effect
 * was undone.
 */
export const executionOutcomes = [
  "succeeded",
  "failed",
  "not-called",
  "unknown",
] as const;
export type ExecutionOutcome = (typeof executionOutcomes)[number];

export type ContractEventDto = {
  id: string;
  surface: ContractSurface;
  coverage: SurfaceId;
  contract: {
    name: string;
    digest: string;
    /** The projection's dialect; null when no projection is stored. */
    dialect: number | null;
    projectionDigest: string | null;
    availability: SchemaAvailability;
  };
  provenance: EventProvenanceDto;
  capture: CaptureState;
  /** The full contract's validation, by `validatedBy`. Null unless captured. */
  validation: ValidationState | null;
  validatedBy: (typeof validators)[number] | null;
  /** Cloud's own check of the projected values against the projection. */
  projectionValidation: (typeof projectionStates)[number] | null;
  /** A receipt's verdict, only when valid and reported; never read from prose. */
  verdict: string | null;
  /** A valid receipt's findings count, derived by the runtime. */
  findingsCount: number | null;
  /** For a tool result: what the provider call did. */
  execution: ExecutionOutcome | null;
  /**
   * For a tool result: whether it was handed on downstream. Only a valid
   * result is; null when the runtime didn't say.
   */
  delivered: boolean | null;
  /** Projected values only; a withheld property is in `redacted`, not here. */
  fields: Record<string, JsonValue>;
  /** Paths the projection withholds: never sent, shown as redacted. */
  redacted: string[];
  /** Reported paths this event left out: optional and not provided. */
  absent: string[];
  issues: SafeValidationIssue[];
  /** How many issues there were; more than `issues` holds when cut. */
  issueCount: number;
  /** Whether this event may satisfy an authoritative requirement. */
  authorizes: boolean;
};

/**
 * The one rule every authorizing reader applies: only a captured, valid,
 * server-validated event that came in on the authoritative path. A reported
 * event, however valid, never authorizes.
 */
export function canAuthorize(event: {
  authority: Authority;
  capture: CaptureState;
  validation: ValidationState | null;
  validatedBy: (typeof validators)[number] | null;
}): boolean {
  return (
    event.authority === "authoritative" &&
    event.capture === "captured" &&
    event.validation === "valid" &&
    event.validatedBy === "server"
  );
}

/** A projected payload: plain JSON, bounded like a receipt. */
export const projectedPayload = boundedJson(MAX_EVENT_PAYLOAD_BYTES);

const jsonAttribute = <T extends z.ZodType>(schema: T, maxBytes: number) =>
  z
    .string()
    .max(maxBytes)
    .transform((text, context) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        context.addIssue({ code: "custom", message: "JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);

const digits = (max: number) =>
  z
    .string()
    .regex(/^\d{1,5}$/)
    .transform(Number)
    .pipe(z.number().max(max));

/**
 * A `nodrail.contract.event` span (reporting schema 3): one exchange a local
 * hook validated against its full contract, with only its projection. The
 * installation reports its own full-validation result; Cloud validates the
 * projected values against the registered projection, derives the verdict
 * and the withheld paths from it, and keeps the event as reported evidence.
 */
const contractEventSpan = z.object({
  "nodrail.machine": z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  "nodrail.host": z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  "nodrail.agent": z.string().min(1).max(200).optional(),
  "nodrail.run": z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  "nodrail.step": z.string().min(1).max(200).optional(),
  "nodrail.contract.surface": z.enum(contractSurfaces),
  "nodrail.contract.name": contractName,
  "nodrail.contract.digest": contractDigest,
  /** A later dialect is refused and counted, never misread as this one. */
  "nodrail.contract.dialect": z.literal(String(CONTRACT_DIALECT)),
  "nodrail.contract.projection": contractDigest.optional(),
  "nodrail.contract.producer": z.enum(reportedProducerClasses),
  "nodrail.contract.capture": z.enum(captureStates),
  "nodrail.contract.validation": z.enum(validationStates).optional(),
  /** Must equal the reported verdict-role value; never a source of its own. */
  "nodrail.contract.verdict": z.string().regex(VERDICT_VALUE).optional(),
  "nodrail.contract.findings": digits(99_999).optional(),
  "nodrail.contract.execution": z.enum(executionOutcomes).optional(),
  "nodrail.contract.delivered": z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  "nodrail.contract.subject": subjectRevision.optional(),
  "nodrail.contract.payload": jsonAttribute(
    projectedPayload,
    MAX_EVENT_PAYLOAD_BYTES,
  ).optional(),
  "nodrail.contract.issues": jsonAttribute(safeIssueList, 4096).optional(),
  "nodrail.contract.issue_count": digits(99_999).optional(),
});

export const contractEventAttributes = contractEventSpan.superRefine(
  (a, context) =>
    consistent(
      {
        surface: a["nodrail.contract.surface"],
        capture: a["nodrail.contract.capture"],
        validation: a["nodrail.contract.validation"],
        verdict: a["nodrail.contract.verdict"],
        findings: a["nodrail.contract.findings"],
        execution: a["nodrail.contract.execution"],
        delivered: a["nodrail.contract.delivered"],
        projection: a["nodrail.contract.projection"],
        payload: a["nodrail.contract.payload"],
        issues: a["nodrail.contract.issues"]?.length ?? 0,
        issueCount: a["nodrail.contract.issue_count"],
      },
      context,
    ),
);
export type ContractEventAttributes = z.infer<typeof contractEventAttributes>;

/**
 * What a Cloud-managed installation submits on the runtime path. The full
 * payload, validated by the server against the pinned contract; the server
 * then stores only its projection. No provenance field: the credential and
 * the server supply it.
 */
export const submitContractEventInput = z
  .object({
    surface: z.enum(contractSurfaces),
    contract_digest: contractDigest,
    idempotency_key: z.string().min(1).max(128),
    run: z
      .object({ key: z.string().min(1).max(200) })
      .strict()
      .optional(),
    step: z.string().min(1).max(200).optional(),
    action_digest: contractDigest.optional(),
    capture: z.enum(captureStates),
    /** The full value, bounded by its surface (docs/contracts.md, Limits). */
    payload: boundedJson(PAYLOAD_BYTES.output).optional(),
    execution: z.enum(executionOutcomes).optional(),
    delivered: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) => (input.capture === "captured") === (input.payload !== undefined),
    {
      path: ["payload"],
      message: "a payload exactly when captured",
    },
  )
  .refine(
    (input) =>
      input.payload === undefined ||
      Buffer.byteLength(JSON.stringify(input.payload)) <=
        submitLimit[input.surface],
    { path: ["payload"], message: "within its surface's limit" },
  )
  .superRefine((input, context) =>
    outcomes(
      {
        surface: input.surface,
        capture: input.capture,
        validation: undefined,
        verdict: undefined,
        findings: undefined,
        execution: input.execution,
        delivered: input.delivered,
      },
      (message) => context.addIssue({ code: "custom", message }),
    ),
  );
export type SubmitContractEventInput = z.infer<typeof submitContractEventInput>;

/** A submitted full value's limit, by surface (the engine's PAYLOAD_BYTES). */
const submitLimit: Record<ContractSurface, number> = {
  receipt: PAYLOAD_BYTES.receipt,
  brief: PAYLOAD_BYTES.brief,
  tool_input: PAYLOAD_BYTES.input,
  tool_result: PAYLOAD_BYTES.output,
  evidence: PAYLOAD_BYTES.evidence,
  memory_record: PAYLOAD_BYTES.memory,
  file: PAYLOAD_BYTES.file,
  inventory_metadata: PAYLOAD_BYTES.inventory,
};

type Outcomes = {
  surface: ContractSurface;
  capture: CaptureState;
  validation: ValidationState | undefined;
  verdict: string | undefined;
  findings: number | undefined;
  execution: ExecutionOutcome | undefined;
  delivered: boolean | undefined;
};

type EventShape = Outcomes & {
  projection: string | undefined;
  payload: unknown;
  issues: number;
  issueCount: number | undefined;
};

/** The same rules as the table's checks, so a bad span is refused early. */
function consistent(e: EventShape, context: z.RefinementCtx) {
  const fail = (message: string) =>
    context.addIssue({ code: "custom", message });
  const captured = e.capture === "captured";
  if (captured !== (e.validation !== undefined))
    fail("a validation exactly when captured");
  if (captured !== (e.projection !== undefined))
    fail("a projection exactly when captured");
  if (!captured && e.payload !== undefined) fail("no payload unless captured");
  outcomes(e, fail);
  const count = e.issueCount ?? e.issues;
  if (count < e.issues) fail("an issue count at least the issues sent");
  if (!captured && count > 0) fail("no issues unless captured");
  if (e.validation === "valid" && count > 0) fail("no issues when valid");
  if (e.validation === "invalid" && count === 0) fail("issues when invalid");
}

/** What only some surfaces, or only valid events, may carry. */
function outcomes(e: Outcomes, fail: (message: string) => void) {
  if (
    e.verdict !== undefined &&
    (e.validation !== "valid" || e.surface !== "receipt")
  )
    fail("a verdict only on a valid receipt");
  if (
    e.findings !== undefined &&
    (e.validation !== "valid" ||
      (e.surface !== "receipt" && e.surface !== "evidence"))
  )
    fail("a findings count only on a valid receipt or evidence");
  resultOutcomes(e, fail);
}

/** A result's execution and delivery, apart from whether it conformed. */
function resultOutcomes(e: Outcomes, fail: (message: string) => void) {
  if (e.execution !== undefined && e.surface !== "tool_result")
    fail("an execution outcome only for a tool result");
  if (e.delivered !== undefined && e.surface !== "tool_result")
    fail("delivered only for a tool result");
  // A call that never reached the provider has no result to have captured.
  if (e.execution === "not-called" && e.capture === "captured")
    fail("no result captured from a call that wasn't made");
  // Only a valid result is handed on; an invalid one is unusable downstream.
  if (
    e.delivered === true &&
    (e.capture !== "captured" || e.validation === "invalid")
  )
    fail("only a captured, valid result is delivered");
}
