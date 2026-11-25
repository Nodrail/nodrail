import "server-only";
import { z } from "zod";
import {
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_STORED_ISSUES,
  type ContractSurface,
} from "@/contracts/v1/declared-contracts";
import {
  safeValidationIssue,
  type ExecutionOutcome,
  type SafeValidationIssue,
} from "@/contracts/v1/contract-events";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import {
  projectShape,
  projectValue,
  validateValue,
  type Projection,
  type ResolvedShape,
} from "@/contracts/v1/shapes-engine";
import { parseRows, type RuntimeContext } from "@/server/db/context";
import { disclosedPath } from "./ingest";

/**
 * Authoritative contract events: exchanges the Cloud
 * runtime path delivered and the server validated against the pinned
 * contract. What is kept is only the projection: the reported values of a
 * valid value, the withheld paths by name, and issues by declared path and
 * code. Shared by step receipts (S01) and submitted briefs, tool inputs and
 * results (S02–S04).
 */

/**
 * A shape's projection. The engine sorts withheld paths before digesting
 * (#110), so the order a shape's keys come in (jsonb reorders them) never
 * changes the digest or the listing.
 */
export const sortedProjection = (shape: ResolvedShape): Projection =>
  projectShape(shape);

/** An issue's path as the projection may name it; never a made-up key. */
export const disclosedIssuePath = (projection: Projection, path: string) =>
  disclosedPath(projection, path === "(value)" ? null : path);

const pinnedRow = z.object({
  digest: z.string(),
  schema: resolvedShape,
  withheld: z.array(z.string()),
});

/**
 * The projection publishing pinned for a contract: the engine's, derived
 * from the pinned shape. A row published before the engine sorted withheld
 * paths (#110) can carry a digest of another order for the same content;
 * it stays as history, but new events always name the canonical digest,
 * the one every engine and client computes now. The stored row is
 * returned only when it is that one.
 */
export async function pinnedProjection(
  context: Pick<RuntimeContext, "manager" | "workspaceId">,
  surface: ContractSurface,
  contractDigest: string,
  shape: ResolvedShape,
): Promise<Projection> {
  const canonical = projectShape(shape);
  const [row] = parseRows(
    pinnedRow,
    await context.manager.query(
      `SELECT digest, schema, withheld FROM nodrail.contract_projections
       WHERE workspace_id = $1 AND surface = $2 AND contract_digest = $3
         AND digest = $4 AND registered_via = 'publish'`,
      [context.workspaceId, surface, contractDigest, canonical.digest],
    ),
  );
  return row
    ? { shape: row.schema, withheld: row.withheld, digest: row.digest }
    : canonical;
}

/** A value as the server read it: valid with its value, or not. */
export type ServerReading =
  | { state: "valid"; value: Record<string, unknown>; findings: number | null }
  | { state: "invalid"; issues: { path: string; code: string }[] }
  | { state: "missing" | "unsupported" };

/** What one authoritative event keeps: states and the projection only. */
export type Kept = {
  capture: "captured" | "missing" | "unsupported";
  validation: "valid" | "invalid" | null;
  projectionDigest: string | null;
  projectionValidation: "valid" | "invalid" | null;
  verdict: string | null;
  findings: number | null;
  payload: Record<string, unknown>;
  redacted: string[];
  issues: SafeValidationIssue[];
  issueCount: number;
};

const verdictName = (projection: Projection) =>
  Object.entries(projection.shape.properties).find(
    ([, property]) => property.role === "verdict",
  )?.[0];

/** The issues safe to keep and show: declared paths, codes, no values. */
export function safeIssues(
  projection: Projection,
  issues: { path: string; code: string }[],
): SafeValidationIssue[] {
  return issues.map(({ path, code }) => {
    const safe = safeValidationIssue.safeParse({
      path: disclosedIssuePath(projection, path),
      code,
    });
    return safe.success ? safe.data : { path: null, code: "other" };
  });
}

/**
 * The projection of a reading. A valid value keeps its reported values
 * (none if they don't fit the projection or the 8 KiB ceiling); an invalid
 * one keeps none, only its issues.
 */
export function keptFrom(reading: ServerReading, projection: Projection): Kept {
  if (reading.state === "missing" || reading.state === "unsupported")
    return {
      capture: reading.state,
      validation: null,
      projectionDigest: null,
      projectionValidation: null,
      verdict: null,
      findings: null,
      payload: {},
      redacted: [],
      issues: [],
      issueCount: 0,
    };
  const valid = reading.state === "valid";
  const projected = valid ? projectValue(projection, reading.value) : {};
  const fits =
    JSON.stringify(projected).length <= MAX_EVENT_PAYLOAD_BYTES &&
    validateValue(projection.shape, projected).length === 0;
  const payload = fits ? projected : {};
  const verdict = valid ? payload[verdictName(projection) ?? ""] : undefined;
  const issues =
    reading.state === "invalid" ? safeIssues(projection, reading.issues) : [];
  return {
    capture: "captured",
    validation: valid ? "valid" : "invalid",
    projectionDigest: projection.digest,
    projectionValidation: fits ? "valid" : "invalid",
    verdict: typeof verdict === "string" ? verdict : null,
    findings: valid ? reading.findings : null,
    payload,
    redacted: projection.withheld,
    issues: issues.slice(0, MAX_STORED_ISSUES),
    issueCount: issues.length,
  };
}

export type AuthoritativeEvent = {
  surface: ContractSurface;
  producerClass: "agent-reported" | "runtime-observed";
  contract: { name: string; digest: string };
  idempotencyKey: string;
  runId: string | null;
  agent: string | null;
  step: string | null;
  actionDigest: string | null;
  kept: Kept;
  execution: ExecutionOutcome | null;
  delivered: boolean | null;
  /** The submission's fingerprint, when its key alone doesn't bind the value. */
  bodyDigest?: string;
};

/**
 * Keeps one authoritative event, once per idempotency key; returns its id,
 * or null when that key was already used (the caller compares).
 */
export async function keepAuthoritative(
  context: RuntimeContext,
  event: AuthoritativeEvent,
): Promise<string | null> {
  const { kept } = event;
  const rows: { id: string }[] = await context.manager.query(
    `INSERT INTO nodrail.contract_events
       (workspace_id, environment_id, authority, producer_class, surface,
        contract_name, contract_digest, projection_digest, installation_id,
        idempotency_key, run_id, agent, step, action_digest, capture,
        validation, validated_by, projection_validation, verdict,
        findings_count, execution, delivered, payload, redacted, issues,
        issue_count, body_digest, occurred_at)
     VALUES ($1, $2, 'authoritative', $3, $4, $5, $6, $7, $8, $9, $10, $11,
             $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
             $25, $26, clock_timestamp())
     ON CONFLICT ON CONSTRAINT contract_events_runtime_once DO NOTHING
     RETURNING id`,
    [
      context.workspaceId,
      context.environmentId,
      event.producerClass,
      event.surface,
      event.contract.name,
      event.contract.digest,
      kept.projectionDigest,
      context.installationId,
      event.idempotencyKey,
      event.runId,
      event.agent,
      event.step,
      event.actionDigest,
      kept.capture,
      kept.validation,
      kept.capture === "captured" ? "server" : null,
      kept.projectionValidation,
      kept.verdict,
      kept.findings,
      event.execution,
      event.delivered,
      JSON.stringify(kept.payload),
      JSON.stringify(kept.redacted),
      JSON.stringify(kept.issues),
      kept.issueCount,
      event.bodyDigest ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}
