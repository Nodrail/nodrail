import "server-only";
import { z } from "zod";
import {
  contractEventAttributes,
  type ContractEventAttributes,
  type SafeValidationIssue,
} from "@/contracts/v1/contract-events";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import {
  validateValue,
  type ResolvedProperty,
  type ResolvedShape,
} from "@/contracts/v1/shapes-engine";
import { parseRows, type WorkspaceContext } from "@/server/db/context";

/**
 * `nodrail.contract.event` spans (reporting schema 3): one exchange
 * a local hook validated against its full contract, reported with only its
 * projection. Cloud keeps the installation's own validation as its claim,
 * checks the projected values against the registered projection with the
 * engine's validator, derives the verdict and the withheld paths from it,
 * and stores the event as reported evidence: it never authorizes.
 */

type Span = {
  traceId: string;
  spanId: string;
  attributes: Record<string, string>;
};

export type ContractSpanWhere = {
  environmentId: string;
  project: { name: string; id: string | null };
};

const projectionRow = z.object({
  contract_digest: z.string(),
  schema: resolvedShape,
  withheld: z.array(z.string()),
});
type Projection = { shape: ResolvedShape; withheld: string[] };

async function projectionFor(
  context: WorkspaceContext,
  a: ContractEventAttributes,
): Promise<Projection | null> {
  const [row] = parseRows(
    projectionRow,
    await context.manager.query(
      `SELECT contract_digest, schema, withheld
       FROM nodrail.contract_projections
       WHERE workspace_id = $1 AND surface = $2 AND digest = $3`,
      [
        context.workspaceId,
        a["nodrail.contract.surface"],
        a["nodrail.contract.projection"],
      ],
    ),
  );
  // A projection of another contract can't stand for this one.
  if (!row || row.contract_digest !== a["nodrail.contract.digest"]) return null;
  return { shape: row.schema, withheld: row.withheld };
}

/**
 * An issue path cut to what the projection names: reported properties
 * (with list indexes), or a withheld path, by name. A key the agent made up
 * is no declared name, so its issue keeps its code and loses its path.
 */
export function disclosedPath(projection: Projection, path: string | null) {
  if (path === null) return null;
  const kept: string[] = [];
  const names: string[] = [];
  let here:
    | ResolvedProperty
    | { type: "root"; properties: ResolvedShape["properties"] } = {
    type: "root",
    properties: projection.shape.properties,
  };
  for (const segment of path.split(".")) {
    if (here.type === "list") {
      if (!/^\d+$/.test(segment)) break;
      kept.push(segment);
      here = here.of;
      continue;
    }
    if (here.type !== "object" && here.type !== "root") break;
    const next: ResolvedProperty | undefined = here.properties[segment];
    if (!next) {
      const withheld = [...names, segment].join(".");
      if (projection.withheld.includes(withheld)) kept.push(segment);
      break;
    }
    kept.push(segment);
    names.push(segment);
    here = next;
  }
  return kept.length ? kept.join(".") : null;
}

/** The projected shape's verdict-role property, if it reports one. */
const verdictProperty = (shape: ResolvedShape) =>
  Object.entries(shape.properties).find(
    ([, property]) => property.role === "verdict",
  )?.[0];

/** An attribute the span may leave out, as a column. */
const nil = <T>(value: T | undefined) => value ?? null;

type Kept = {
  payload: Record<string, unknown>;
  projectionValidation: "valid" | "invalid" | null;
  verdict: unknown;
  issues: SafeValidationIssue[];
  redacted: string[];
};

/** An exchange that wasn't captured keeps no values, states or issues. */
const NOTHING_KEPT: Kept = {
  payload: {},
  projectionValidation: null,
  verdict: null,
  issues: [],
  redacted: [],
};

/** What a captured event keeps after its projection has had its say. */
function judged(a: ContractEventAttributes, projection: Projection): Kept {
  const sent = a["nodrail.contract.payload"] ?? {};
  const conforms = validateValue(projection.shape, sent).length === 0;
  const payload = conforms ? sent : {};
  const name = verdictProperty(projection.shape);
  const verdict =
    conforms &&
    name &&
    a["nodrail.contract.surface"] === "receipt" &&
    a["nodrail.contract.validation"] === "valid" &&
    typeof payload[name] === "string"
      ? payload[name]
      : null;
  const issues: SafeValidationIssue[] = (
    a["nodrail.contract.issues"] ?? []
  ).map((issue) => ({ ...issue, path: disclosedPath(projection, issue.path) }));
  return {
    payload,
    projectionValidation: conforms ? "valid" : "invalid",
    verdict,
    issues,
    redacted: projection.withheld,
  };
}

/**
 * Keeps one contract span as its sender's report; false when the contract
 * doesn't read it: malformed, an unregistered projection, a projection of
 * another contract, or a verdict the projection doesn't report. A retry of
 * the same span changes nothing; one that arrives late lands by its time.
 */
export async function keepContractSpan(
  context: WorkspaceContext,
  where: ContractSpanWhere,
  span: Span,
  occurredAt: Date,
) {
  const parsed = contractEventAttributes.safeParse(span.attributes);
  if (!parsed.success) return false;
  const a = parsed.data;
  const captured = a["nodrail.contract.capture"] === "captured";
  const projection = captured ? await projectionFor(context, a) : null;
  if (captured && !projection) return false;
  const kept = projection ? judged(a, projection) : NOTHING_KEPT;
  const claimed = a["nodrail.contract.verdict"];
  if (claimed !== undefined && claimed !== kept.verdict) return false;
  const subject = nil(a["nodrail.contract.subject"]);
  const issues = a["nodrail.contract.issues"] ?? [];
  await context.manager.query(
    `INSERT INTO nodrail.contract_events
       (workspace_id, environment_id, authority, producer_class, surface,
        contract_name, contract_digest, projection_digest, user_id, trace_id,
        span_id, machine, project_id, project, host, run, agent, step,
        subject_revision, subject_source, capture, validation, validated_by,
        projection_validation, verdict, findings_count, execution, delivered,
        payload, redacted, issues, issue_count, occurred_at)
     VALUES ($1, $2, 'reported', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
             $26, $27, $28, $29, $30, $31, $32)
     ON CONFLICT ON CONSTRAINT contract_events_reported_once DO NOTHING`,
    [
      context.workspaceId,
      where.environmentId,
      a["nodrail.contract.producer"],
      a["nodrail.contract.surface"],
      a["nodrail.contract.name"],
      a["nodrail.contract.digest"],
      nil(a["nodrail.contract.projection"]),
      context.principal.userId,
      span.traceId,
      span.spanId,
      nil(a["nodrail.machine"]),
      where.project.id,
      where.project.name,
      a["nodrail.host"],
      nil(a["nodrail.run"]),
      nil(a["nodrail.agent"]),
      nil(a["nodrail.step"]),
      subject,
      subject && "runtime-observed",
      a["nodrail.contract.capture"],
      nil(a["nodrail.contract.validation"]),
      captured ? "producer" : null,
      kept.projectionValidation,
      kept.verdict,
      nil(a["nodrail.contract.findings"]),
      nil(a["nodrail.contract.execution"]),
      nil(a["nodrail.contract.delivered"]),
      JSON.stringify(kept.payload),
      JSON.stringify(kept.redacted),
      JSON.stringify(kept.issues),
      a["nodrail.contract.issue_count"] ?? issues.length,
      occurredAt,
    ],
  );
  return true;
}
