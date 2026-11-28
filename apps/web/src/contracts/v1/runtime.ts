import { isPlainJson, type JsonValue } from "@nodrail/sdk/protocol";
import { runContext, runEvent } from "@nodrail/sdk";
import { z } from "zod";
import { resourceScope, ruleInput } from "./policies";

/** Requests above this are refused before any parsing work. */
export const MAX_RUNTIME_BODY_BYTES = 64 * 1024;
const MAX_PARAMS_BYTES = 32 * 1024;
const MAX_DETAILS_BYTES = 8 * 1024;

/** Per installation, across every server. A waiting hook polls 30 times. */
export const RUNTIME_CALLS_PER_MINUTE = 600;

/** How long a permit can be used. Its only job is to be collected and spent. */
export const PERMIT_TTL_SECONDS = 5;

export const policyDigest = z.string().regex(/^[0-9a-f]{64}$/);

export const idempotencyKey = z.string().min(1).max(128);

/** A plain JSON object of at most `maxBytes` once serialized. */
export const boundedJson = (maxBytes: number) =>
  z
    .record(z.string(), z.unknown())
    .refine(
      (value): value is Record<string, JsonValue> =>
        isPlainJson(value) &&
        Buffer.byteLength(JSON.stringify(value)) <= maxBytes,
    );

/** A step as the engine names it: the integration's id and the agent's name. */
const runStep = runContext.shape.step.unwrap();

/** The run an intent belongs to, as the installation declares it. */
export const runInput = z
  .object({ key: runContext.shape.run, step: runStep.optional() })
  .strict();

/**
 * The work revision a governed call is about (`workRevision`, computed by
 * the installation), or null when it couldn't be read: unknown, never a
 * guess. A gate on `subject: revision` checks evidence against it.
 */
export const subjectInput = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .nullable();

/** The revision as stored: the digest's hex, or null when unknown. */
export const storedSubject = (subject: string | null | undefined) =>
  subject ? subject.slice("sha256:".length) : null;

/** Longest receipt block a hook may send for the server to read. */
export const MAX_RECEIPT_TEXT = 8192;

/** What a finished step reported: read by the caller, or sent as the block. */
const receiptInput = z.union([
  runEvent.options[1].pick({ verdict: true, findings: true, usage: true }),
  z.object({ text: z.string().max(MAX_RECEIPT_TEXT) }).strict(),
]);

export const runtimeAgent = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
  .optional();

export const stepInput = z
  .object({
    agent: runtimeAgent,
    policy_digest: policyDigest.optional(),
    run: runInput.pick({ key: true }),
    step: runStep,
    event: z.enum(["started", "finished"]),
    receipt: receiptInput.optional(),
    /**
     * Where the hook captured the final message: the stop event (the
     * default) or the hand-back tool call. Recorded with a declared receipt.
     */
    via: z.enum(["stop", "handback"]).optional(),
  })
  .strict()
  .refine((input) => input.event === "finished" || !input.receipt, {
    path: ["receipt"],
  })
  .refine((input) => input.event === "finished" || !input.via, {
    path: ["via"],
  });

export const submitActionInput = z
  .object({
    agent: runtimeAgent,
    tool: ruleInput.shape.toolKey,
    operation: ruleInput.shape.operationKey,
    resource: z
      .object({
        kind: resourceScope.shape.kind,
        id: z.string().min(1).max(512),
      })
      .strict(),
    params: boundedJson(MAX_PARAMS_BYTES),
    adapter_version: z.string().min(1).max(32).optional(),
    run: runInput.extend({ subject: subjectInput.optional() }).optional(),
  })
  .strict();

export const permitInput = z
  .object({
    action_digest: z.string().min(1).max(128),
    nonce: z.string().min(16).max(128),
    /** The revision again at permit time: the work may have changed meanwhile. */
    subject: subjectInput.optional(),
  })
  .strict();

/** Most amounts one report may carry. */
export const MAX_MEASURED = 20;

/**
 * An amount a call's result measured, for a budget that sums it: a
 * `result.` path and a whole, non-negative, safe number. Only paths that a
 * budget this action reserved sums are accepted; the report checks that.
 */
const measuredInput = z
  .object({
    path: z.string().regex(/^result(?:\.[a-z][a-z0-9_]{0,62}){1,6}$/),
    value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export const reportInput = z
  .object({
    agent: runtimeAgent,
    report_key: z.string().min(1).max(128),
    outcome: z.enum(["success", "failure", "unknown"]),
    permit_id: z.uuid().optional(),
    tokens: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    details: boundedJson(MAX_DETAILS_BYTES).optional(),
    measured: z
      .array(measuredInput)
      .max(MAX_MEASURED)
      .refine(
        (items) => new Set(items.map(({ path }) => path)).size === items.length,
        { message: "Each path once" },
      )
      .optional(),
  })
  .strict();

/** Nothing to say: the action named in the path is the whole request. */
export const withdrawInput = z.object({}).strict();

export const heartbeatInput = z
  .object({
    adapter_version: z.string().min(1).max(32).optional(),
    policy_digest: policyDigest.nullable().optional(),
  })
  .strict();
