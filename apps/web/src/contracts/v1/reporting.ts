import { z } from "zod";
import type { ContractEventDto } from "./contract-events";

/**
 * What an installation reports (reporting contract v2): decisions
 * its local hook made and its runs' steps. Evidence only: nothing here
 * authorizes an action or satisfies a Cloud gate.
 */

/**
 * Schemas the receiver reads; a span without one is schema 1. Schema 3
 * adds `nodrail.contract.event` spans (declared-contracts.ts) and changes
 * nothing else, so a client that reports no contracts may keep sending 2.
 */
export const REPORTING_SCHEMAS = ["1", "2", "3"] as const;

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const label = (max: number) => z.string().min(1).max(max);
const count = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number);
/** As a number prints: 0.04, 1200, 1e-7. */
const amount = z
  .string()
  .max(30)
  .transform(Number)
  .pipe(z.number().nonnegative().finite());

/** Shared by every reported span: where it ran. */
const source = {
  "nodrail.machine": z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  "nodrail.host": z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  "nodrail.agent": label(200).optional(),
};

/** The run's hashed key and the step, when the rules keep a ledger. */
const inRun = {
  "nodrail.run": z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .optional(),
  "nodrail.step": label(200).optional(),
};

/** A `nodrail.decision` span: what the local hook told its host. */
export const decisionAttributes = z.object({
  ...source,
  ...inRun,
  "nodrail.decision": z.enum(["allow", "deny", "would_deny"]),
  "nodrail.tool": label(64).optional(),
  "nodrail.operation": label(128).optional(),
  "nodrail.resource.kind": label(64).optional(),
  "nodrail.match": label(40).optional(),
  "nodrail.rule": label(200).optional(),
  "nodrail.policy.revision": digest.optional(),
  /** Legacy: 16 hex characters of a JSON hash; never compared. */
  "nodrail.revision": z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .optional(),
  "session.id": label(200).optional(),
  "gen_ai.tool.call.id": label(200).optional(),
});

const contractDigestAttribute = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** The contract checks a decision span may carry, by what they read. */
export const DECISION_CHECKS = {
  brief: ["valid", "invalid", "missing", "unobservable"],
  input: ["valid", "invalid"],
} as const;
export type DecisionCheck = {
  surface: keyof typeof DECISION_CHECKS;
  state: (typeof DECISION_CHECKS)[keyof typeof DECISION_CHECKS][number];
  contract: string;
};

/**
 * Schema 3: what a call's declared contract said before the local hook
 * decided it (S02, S03), named as run events name their checks
 * (`nodrail.<side>.state` and `.contract`): the started agent's brief or
 * the operation's input, by state and contract digest. Names and states
 * only, never a value; at most one, with its state and contract together.
 */
export const contractDecisionAttributes = decisionAttributes
  .extend({
    "nodrail.brief.state": z.enum(DECISION_CHECKS.brief).optional(),
    "nodrail.brief.contract": contractDigestAttribute.optional(),
    "nodrail.input.state": z.enum(DECISION_CHECKS.input).optional(),
    "nodrail.input.contract": contractDigestAttribute.optional(),
  })
  .refine(
    (a) =>
      (a["nodrail.brief.state"] === undefined) ===
        (a["nodrail.brief.contract"] === undefined) &&
      (a["nodrail.input.state"] === undefined) ===
        (a["nodrail.input.contract"] === undefined) &&
      (a["nodrail.brief.state"] === undefined ||
        a["nodrail.input.state"] === undefined),
    "a check's state and contract together, for a brief or an input",
  );

/** A `nodrail.run.event` span: a step or action the run's ledger recorded. */
export const runEventAttributes = z.object({
  ...source,
  "nodrail.run": z.string().regex(/^[0-9a-f]{32}$/),
  "nodrail.step": label(200).optional(),
  "nodrail.agent": label(200),
  "nodrail.run.event": z.enum(["step.started", "step.finished", "action"]),
  /** The step's receipt verdict: a name the rules use, such as pass. */
  "nodrail.verdict": z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,31}$/)
    .optional(),
  "nodrail.findings": count.pipe(z.number().max(1000)).optional(),
  "nodrail.usage.tokens": amount.optional(),
  "nodrail.usage.usd": amount.optional(),
  "nodrail.tool": label(64).optional(),
  "nodrail.operation": label(128).optional(),
  "nodrail.outcome": label(40).optional(),
  "nodrail.change": z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  /**
   * Schema 3: a step's receipt read against its declared contract, by state
   * and contract digest; its values never leave the machine on this span.
   */
  "nodrail.receipt.state": z.enum(["valid", "invalid", "missing"]).optional(),
  "nodrail.receipt.contract": contractDigestAttribute.optional(),
});

/**
 * A run event as schema 3 reads it: a receipt's state and contract go
 * together, on a finished step, and only a valid one has a verdict.
 */
export const contractRunEventAttributes = runEventAttributes.refine(
  (a) =>
    (a["nodrail.receipt.state"] === undefined) ===
      (a["nodrail.receipt.contract"] === undefined) &&
    (a["nodrail.receipt.state"] === undefined ||
      (a["nodrail.run.event"] === "step.finished" &&
        (a["nodrail.receipt.state"] === "valid" ||
          a["nodrail.verdict"] === undefined))),
  "a receipt's state and contract together, a verdict only when valid",
);

/** The resource every span of one export shares. */
export const reportingResource = z.object({
  "nodrail.schema": z.enum(REPORTING_SCHEMAS).optional(),
  "nodrail.project": label(200),
  "nodrail.project.id": z.uuid().optional(),
});

/** How a page names where a record comes from. */
export const LOCAL_SOURCE_LABEL =
  "Local enforcement · reported by this installation";
export const CLOUD_SOURCE_LABEL = "Cloud-managed action";

export type ReportedDecisionDto = {
  id: string;
  person: string;
  mine: boolean;
  machine: string | null;
  project: string;
  projectBound: boolean;
  host: string;
  agent: string | null;
  decision: "allow" | "deny" | "would_deny";
  tool: string | null;
  operation: string | null;
  resourceKind: string | null;
  rule: string | null;
  policyRevision: string | null;
  run: string | null;
  /** Schema 3: the brief or input check the decision followed, if reported. */
  check: DecisionCheck | null;
  occurredAt: string;
  receivedAt: string;
};

export type LocalRunDto = {
  /** The run's source (person, project, machine and run key), hashed. */
  id: string;
  /** The run's hashed key; the same key elsewhere is another run. */
  run: string;
  project: string;
  /** Whether the project reported its stable id. */
  projectBound: boolean;
  /** The machine's random id, as reported. */
  machine: string | null;
  host: string;
  person: string;
  mine: boolean;
  startedAt: string;
  lastAt: string;
  steps: {
    step: string;
    agent: string;
    startedAt: string | null;
    finishedAt: string | null;
    /** Null when the step reported no verdict, or hasn't finished. */
    verdict: string | null;
    findings: number | null;
    tokens: number | null;
    usd: number | null;
    /**
     * The step's latest receipt checked against a declared contract, as
     * reported; null when none was reported for it.
     */
    receipt: ContractEventDto | null;
    /**
     * The receipt's state and contract digest as the run event reported
     * them (schema 3); null when it reported none.
     */
    receiptState: "valid" | "invalid" | "missing" | null;
    receiptContract: string | null;
    /**
     * The step's briefs, connection inputs and results as reported, oldest
     * first; projection only.
     */
    exchanges: ContractEventDto[];
  }[];
  actions: { allowed: number; denied: number; other: number };
};
