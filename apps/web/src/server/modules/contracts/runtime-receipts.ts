import "server-only";
import { createHash } from "node:crypto";
import { fingerprint } from "@nodrail/sdk/protocol";
import {
  MAX_STORED_ISSUES,
  surfaceCoverage,
} from "@/contracts/v1/declared-contracts";
import {
  canAuthorize,
  safeValidationIssue,
  type ContractEventDto,
} from "@/contracts/v1/contract-events";
import { CLOUD_SOURCE_LABEL } from "@/contracts/v1/reporting";
import {
  CONTRACT_DIALECT,
  readContractReceipt,
  type ReceiptContract,
  type ReceiptReading,
  type ResolvedProperty,
} from "@/contracts/v1/shapes-engine";
import type { RuntimeContext } from "@/server/db/context";
import type { ReceiptRecord } from "@/server/modules/runs/history";
import {
  disclosedIssuePath,
  keepAuthoritative,
  keptFrom,
  pinnedProjection,
  sortedProjection,
} from "./authoritative";

/**
 * A step's receipt on the Cloud runtime path: read
 * by the server with the agent's receipt contract from the live policy, by
 * the engine's own reader, so the gate that checks it and the hook that
 * sent it agree. What the run keeps is the record the engine's gates read,
 * minus classified values; what views keep is an authoritative event with
 * only the projection.
 */

/** Where the runtime captured the final message. */
export type Capture = ReceiptRecord["via"];

/** What a hook sent: the block as written, a reading of its own, or nothing. */
export type SentReceipt = { text: string } | object | undefined;

const NO_MESSAGE: ReceiptReading = {
  state: "missing",
  format: "fenced",
  reason: "the step ended without a final message the hook could read",
  issues: [{ path: "(value)", code: "not-final" }],
};

/**
 * The receipt read against the contract, for the agent the runtime saw
 * dispatched. Only the block as written can be checked: a hook's own
 * reading of a declared receipt is refused, never trusted.
 */
export function readDeclaredReceipt(
  sent: SentReceipt,
  contract: ReceiptContract,
  agent: string,
): ReceiptReading {
  if (!sent) return NO_MESSAGE;
  if ("text" in sent) return readContractReceipt(sent.text, contract, agent);
  return {
    state: "invalid",
    format: contract.format,
    reason: `${agent} has a declared receipt contract: send the receipt block as written, so Cloud reads it`,
    issues: [{ path: "(value)", code: "parse" }],
  };
}

/**
 * A value without what a `secret` or `pii` classification covers. Also
 * what verifier evidence keeps for the gate evaluator.
 */
export function unclassified(
  properties: Record<string, ResolvedProperty>,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [name, found] of Object.entries(value)) {
    const property = properties[name];
    if (!property || property.classification !== null) continue;
    kept[name] = keptValue(property, found);
  }
  return kept;
}

function keptValue(property: ResolvedProperty, value: unknown): unknown {
  if (property.type === "object")
    return unclassified(property.properties, value as Record<string, unknown>);
  if (property.type === "list")
    return (value as unknown[]).map((item) => keptValue(property.of, item));
  return value;
}

const projectionOf = (contract: ReceiptContract) =>
  sortedProjection(contract.shape);

const disclosed = disclosedIssuePath;

/**
 * The record a finished step keeps: the engine's `ReceiptRecord`, its
 * value without classified properties (a gate's `where` on one stays
 * unmet in Cloud), its issues with only declared paths.
 */
export function receiptRecord(
  reading: ReceiptReading,
  contract: ReceiptContract,
  via: Capture,
): ReceiptRecord {
  const valid = reading.state === "valid";
  const projection = projectionOf(contract);
  return {
    name: contract.name,
    contract: contract.contract,
    state: reading.state,
    via,
    value: valid
      ? unclassified(contract.shape.properties, reading.value)
      : null,
    findings: valid ? reading.findings : null,
    issues: valid
      ? []
      : reading.issues.slice(0, MAX_STORED_ISSUES).map((issue) => ({
          path: disclosed(projection, issue.path) ?? "(value)",
          code: issue.code.slice(0, 40),
        })),
    reason: valid ? null : reading.reason.slice(0, 1000),
  };
}

/** Two finishes say the same when their readings are equal, wherever captured. */
export const sameReading = (a: ReceiptRecord, b: ReceiptRecord) =>
  fingerprint({ ...a, via: null }) === fingerprint({ ...b, via: null });

/** Whether a gate can use it: anything else may still be replaced. */
export const usable = (record: ReceiptRecord | undefined) =>
  record?.state === "valid";
type Finished = {
  step: string;
  agent: string;
  at: string;
  verdict: string | null;
};

/**
 * A finished step's receipt as the event a gate explanation reads: Cloud
 * read it on the runtime path, so it is authoritative and server-validated.
 * Its values are the run's (so a condition is judged as the engine judges
 * it), and the paths the projection withholds are marked, so an
 * explanation shows only what the contract reports.
 */
export function stepReceiptEvent(
  finished: Finished,
  record: ReceiptRecord,
  contract: ReceiptContract,
): ContractEventDto {
  const projection = projectionOf(contract);
  const captured = record.state !== "missing";
  const issues = record.issues.map(({ path, code }) => {
    const safe = safeValidationIssue.safeParse({ path, code });
    return safe.success ? safe.data : { path: null, code: "other" as const };
  });
  const state = {
    authority: "authoritative" as const,
    capture: captured ? ("captured" as const) : ("missing" as const),
    validation: captured ? (record.state as "valid" | "invalid") : null,
    validatedBy: captured ? ("server" as const) : null,
  };
  return {
    id: `step:${finished.step}`,
    surface: "receipt",
    coverage: surfaceCoverage.receipt,
    contract: {
      name: record.name,
      digest: record.contract,
      dialect: CONTRACT_DIALECT,
      projectionDigest: projection.digest,
      availability: "pinned",
    },
    provenance: {
      authority: "authoritative",
      producerClass: "agent-reported",
      sourceLabel: CLOUD_SOURCE_LABEL,
      installation: "",
      agent: finished.agent,
      runId: null,
      step: finished.step,
      actionDigest: null,
      subject: null,
      occurredAt: finished.at,
      receivedAt: finished.at,
    },
    ...state,
    projectionValidation: null,
    verdict: record.state === "valid" ? finished.verdict : null,
    findingsCount: record.findings,
    execution: null,
    delivered: null,
    fields: (record.value ?? {}) as ContractEventDto["fields"],
    redacted: projection.withheld,
    absent: [],
    issues: issues.slice(0, MAX_STORED_ISSUES),
    issueCount: issues.length,
    authorizes: canAuthorize(state),
  };
}

/**
 * Keeps the reading as an authoritative event: validated here, by the
 * server, against the pinned contract, with only its projection. Once per
 * distinct reading of a step; a repeat changes nothing.
 */
export async function keepReceiptEvent(
  context: RuntimeContext,
  where: { runId: string; step: string; agent: string },
  read: {
    contract: ReceiptContract;
    record: ReceiptRecord;
    reading: ReceiptReading;
  },
) {
  const { contract, record, reading } = read;
  const projection = await pinnedProjection(
    context,
    "receipt",
    contract.contract,
    contract.shape,
  );
  const key = createHash("sha256")
    .update(
      `${where.runId}\n${where.step}\n${fingerprint({ ...record, via: null })}`,
    )
    .digest("hex");
  await keepAuthoritative(context, {
    surface: "receipt",
    producerClass: "agent-reported",
    contract: { name: contract.name, digest: contract.contract },
    idempotencyKey: `receipt:${key}`,
    runId: where.runId,
    agent: where.agent,
    step: where.step,
    actionDigest: null,
    kept: keptFrom(reading, projection),
    execution: null,
    delivered: null,
  });
}
