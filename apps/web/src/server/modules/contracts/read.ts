import "server-only";
import type { JsonValue } from "@nodrail/sdk/protocol";
import { z } from "zod";
import { seesWholeWorkspace } from "@/contracts/v1/access";
import {
  canAuthorize,
  executionOutcomes,
  safeIssueList,
  type ContractEventDto,
  type EventProvenanceDto,
} from "@/contracts/v1/contract-events";
import {
  contractEventsQuery,
  type ContractEventPageDto,
  type IncompleteReason,
} from "@/contracts/v1/contract-reads";
import {
  surfaceCoverage,
  type ContractSurface,
} from "@/contracts/v1/declared-contracts";
import {
  CLOUD_SOURCE_LABEL,
  LOCAL_SOURCE_LABEL,
} from "@/contracts/v1/reporting";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import { valueAt } from "@/contracts/v1/shapes-engine";
import {
  AppError,
  decodeCursor,
  encodeCursor,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";
import { projectedFields } from "./registry";

/**
 * Reading declared-contract events: the inspector's events, with
 * their projection, what it withholds and what the event left out, and the
 * reasons a page may be incomplete. Admins and policy managers see every
 * event; anyone else their own reports, as for local runs. Read only.
 */

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

const eventRow = z.object({
  id: z.uuid(),
  authority: z.enum(["reported", "authoritative"]),
  producer_class: z.string(),
  surface: z.string(),
  contract_name: z.string(),
  contract_digest: z.string(),
  projection_digest: nullable(z.string()),
  user_id: nullable(z.uuid()),
  display_name: nullable(z.string()),
  machine: nullable(z.string()),
  project_id: nullable(z.string()),
  project: nullable(z.string()),
  host: nullable(z.string()),
  run: nullable(z.string()),
  installation_id: nullable(z.string()),
  run_id: nullable(z.string()),
  action_digest: nullable(z.string()),
  agent: nullable(z.string()),
  step: nullable(z.string()),
  subject_revision: nullable(z.string()),
  subject_source: nullable(z.string()),
  capture: z.enum(["captured", "missing", "unsupported"]),
  validation: nullable(z.enum(["valid", "invalid"])),
  validated_by: nullable(z.enum(["producer", "server"])),
  projection_validation: nullable(z.enum(["valid", "invalid"])),
  verdict: nullable(z.string()),
  findings_count: nullable(z.number()),
  execution: nullable(z.enum(executionOutcomes)),
  delivered: nullable(z.boolean()),
  payload: z.record(z.string(), z.unknown()),
  redacted: z.array(z.string()),
  issues: safeIssueList,
  issue_count: z.number(),
  occurred_at: z.date(),
  received_at: z.date(),
  projected: resolvedShape.nullable(),
  dialect: nullable(z.number()),
  pinned: z.boolean(),
});
type EventRow = z.infer<typeof eventRow>;

/** Every column the DTO reads, the projection and whether the schema is pinned. */
const SELECT = `
  SELECT e.id, e.authority, e.producer_class, e.surface, e.contract_name,
         e.contract_digest, e.projection_digest, e.user_id, u.display_name,
         e.machine, e.project_id, e.project, e.host, e.run, e.installation_id,
         e.run_id, e.action_digest, e.agent, e.step,
         e.subject_revision, e.subject_source, e.capture, e.validation,
         e.validated_by, e.projection_validation, e.verdict, e.findings_count,
         e.execution, e.delivered, e.payload, e.redacted, e.issues, e.issue_count,
         e.occurred_at, e.received_at, p.schema AS projected, p.dialect,
         EXISTS (SELECT 1 FROM nodrail.contract_revisions r
                 WHERE r.workspace_id = e.workspace_id AND r.surface = e.surface
                   AND r.digest = e.contract_digest) AS pinned
  FROM nodrail.contract_events e
  LEFT JOIN nodrail.users u ON u.id = e.user_id
  LEFT JOIN nodrail.contract_projections p
    ON p.workspace_id = e.workspace_id AND p.surface = e.surface
   AND p.digest = e.projection_digest`;

function provenance(row: EventRow, userId: string): EventProvenanceDto {
  const at = {
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
  };
  if (row.authority === "reported")
    return {
      authority: "reported",
      producerClass: row.producer_class as "agent-reported",
      sourceLabel: LOCAL_SOURCE_LABEL,
      person: row.display_name ?? "",
      mine: row.user_id === userId,
      machine: row.machine?.slice(0, 8) ?? null,
      project: row.project ?? "",
      projectBound: row.project_id !== null,
      host: row.host ?? "",
      agent: row.agent,
      run: row.run,
      step: row.step,
      subject: row.subject_revision
        ? { revision: row.subject_revision, source: "runtime-observed" }
        : null,
      ...at,
    };
  return {
    authority: "authoritative",
    producerClass: row.producer_class as "runtime-observed",
    sourceLabel: CLOUD_SOURCE_LABEL,
    installation: row.installation_id ?? "",
    agent: row.agent,
    runId: row.run_id,
    step: row.step,
    actionDigest: row.action_digest,
    subject: row.subject_revision
      ? {
          revision: row.subject_revision,
          source: row.subject_source as "runtime-observed",
        }
      : null,
    ...at,
  };
}

/** Reported paths the event left out: optional and not provided. */
function absentPaths(row: EventRow) {
  if (!row.projected || row.projection_validation !== "valid") return [];
  return projectedFields(row.projected)
    .filter(
      (field) => valueAt(row.payload, field.path.split(".")) === undefined,
    )
    .map((field) => field.path);
}

export function toEventDto(row: EventRow, userId: string): ContractEventDto {
  const surface = row.surface as ContractSurface;
  return {
    id: row.id,
    surface,
    coverage: surfaceCoverage[surface],
    contract: {
      name: row.contract_name,
      digest: row.contract_digest,
      dialect: row.dialect,
      projectionDigest: row.projection_digest,
      availability: row.pinned
        ? "pinned"
        : row.projected
          ? "projection_only"
          : "unavailable",
    },
    provenance: provenance(row, userId),
    capture: row.capture,
    validation: row.validation,
    validatedBy: row.validated_by,
    projectionValidation: row.projection_validation,
    verdict: row.verdict,
    findingsCount: row.findings_count,
    execution: row.execution,
    delivered: row.delivered,
    fields: row.payload as Record<string, JsonValue>,
    redacted: row.redacted,
    absent: absentPaths(row),
    issues: row.issues,
    issueCount: row.issue_count,
    authorizes: canAuthorize({
      authority: row.authority,
      capture: row.capture,
      validation: row.validation,
      validatedBy: row.validated_by,
    }),
  };
}

/**
 * Who sees which events: everyone's for admins and policy managers; anyone
 * else only the reports they sent. Authoritative events carry no person, so
 * until they follow Activity's agent scoping only the first see them.
 */
async function scope(context: WorkspaceContext, environmentSlug: string) {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const whole = seesWholeWorkspace(context.role);
  return {
    whole,
    params: [
      context.workspaceId,
      environment.id,
      whole,
      context.principal.userId,
    ] as unknown[],
    where: `e.workspace_id = $1 AND e.environment_id = $2 AND ($3 OR e.user_id = $4)`,
  };
}

const FILTERS = {
  surface: "e.surface",
  contract: "e.contract_digest",
  authority: "e.authority",
  capture: "e.capture",
  validation: "e.validation",
} as const;

/** A page of events, newest first, with why it may not be everything. */
export async function listContractEvents(
  context: WorkspaceContext,
  environmentSlug: string,
  rawQuery: unknown,
): Promise<ContractEventPageDto> {
  const query = parseInput(contractEventsQuery, rawQuery);
  const { whole, params, where } = await scope(context, environmentSlug);
  const clauses = [where];
  for (const [key, column] of Object.entries(FILTERS)) {
    const value = query[key as keyof typeof FILTERS];
    if (value === undefined) continue;
    params.push(value);
    clauses.push(`${column} = $${params.length}`);
  }
  if (query.run) {
    params.push(query.run);
    clauses.push(
      `(e.run = $${params.length} OR e.run_id::text = $${params.length})`,
    );
  }
  const cursor = decodeCursor(query.cursor);
  if (cursor.at) {
    params.push(cursor.at, cursor.id);
    clauses.push(
      `(e.occurred_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  const rows = parseRows(
    eventRow,
    await context.manager.query(
      `${SELECT} WHERE ${clauses.join(" AND ")}
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT ${query.limit + 1}`,
      params,
    ),
  );
  const items = rows
    .slice(0, query.limit)
    .map((row) => toEventDto(row, context.principal.userId));
  const last = items.at(-1);
  const more = rows.length > query.limit && last !== undefined;
  const reasons: IncompleteReason[] = [];
  if (more) reasons.push("more_pages");
  if (!whole) reasons.push("own_reports_only");
  if (items.some((item) => item.contract.availability === "unavailable"))
    reasons.push("schema_unavailable");
  return {
    items,
    nextCursor: more ? encodeCursor(last.provenance.occurredAt, last.id) : null,
    completeness: { complete: reasons.length === 0, reasons },
  };
}

export async function getContractEvent(
  context: WorkspaceContext,
  environmentSlug: string,
  id: string,
): Promise<ContractEventDto> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const { params, where } = await scope(context, environmentSlug);
  params.push(id);
  const [row] = parseRows(
    eventRow,
    await context.manager.query(
      `${SELECT} WHERE ${where} AND e.id = $${params.length}`,
      params,
    ),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return toEventDto(row, context.principal.userId);
}

/**
 * The latest receipt each local run step reported, keyed by the run's
 * source (person, project, machine, run key, as local runs key them) and
 * the step. The latest by when it happened wins, whenever it arrived.
 */
export async function localStepReceipts(
  context: WorkspaceContext,
  environmentSlug: string,
  runSource: string,
  sources: string[],
): Promise<Map<string, ContractEventDto>> {
  if (sources.length === 0) return new Map();
  const { params, where } = await scope(context, environmentSlug);
  params.push(sources);
  const rows = parseRows(
    eventRow.extend({ source: z.string() }),
    await context.manager.query(
      `SELECT DISTINCT ON (source, e.step) * FROM (
         ${SELECT.replace("SELECT e.id", `SELECT md5(${runSource}) AS source, e.id`)}
         WHERE ${where} AND e.authority = 'reported'
           AND e.surface = 'receipt' AND e.run IS NOT NULL
           AND e.step IS NOT NULL
           AND md5(${runSource}) = ANY($${params.length})) e
       ORDER BY source, e.step, e.occurred_at DESC, e.id DESC
       LIMIT 5000`,
      params,
    ),
  );
  return new Map(
    rows.map((row) => [
      `${row.source}/${row.step}`,
      toEventDto(row, context.principal.userId),
    ]),
  );
}

/** Exchanges besides receipts: briefs, connection inputs and results. */
const EXCHANGES = `e.surface IN ('brief', 'tool_input', 'tool_result')`;

/** Events grouped by a key, oldest first within each. */
function grouped(
  rows: (EventRow & { key: string })[],
  userId: string,
): Map<string, ContractEventDto[]> {
  const groups = new Map<string, ContractEventDto[]>();
  for (const row of rows)
    groups.set(row.key, [
      ...(groups.get(row.key) ?? []),
      toEventDto(row, userId),
    ]);
  return groups;
}

/**
 * Each local run step's reported briefs, inputs and results, keyed as
 * `localStepReceipts` keys receipts, oldest first.
 */
export async function localStepExchanges(
  context: WorkspaceContext,
  environmentSlug: string,
  runSource: string,
  sources: string[],
): Promise<Map<string, ContractEventDto[]>> {
  if (sources.length === 0) return new Map();
  const { params, where } = await scope(context, environmentSlug);
  params.push(sources);
  const keyed = `SELECT md5(${runSource}) || '/' || e.step AS key, e.id`;
  const rows = parseRows(
    eventRow.extend({ key: z.string() }),
    await context.manager.query(
      `${SELECT.replace("SELECT e.id", keyed)}
       WHERE ${where} AND e.authority = 'reported' AND ${EXCHANGES}
         AND e.run IS NOT NULL AND e.step IS NOT NULL
         AND md5(${runSource}) = ANY($${params.length})
       ORDER BY e.occurred_at, e.id
       LIMIT 5000`,
      params,
    ),
  );
  return grouped(rows, context.principal.userId);
}

/**
 * A Cloud run's authoritative briefs, inputs and results, oldest first:
 * keyed `action:<digest>` when bound to one of the run's actions, else
 * `step:<key>`.
 */
export async function runExchanges(
  context: WorkspaceContext,
  environmentSlug: string,
  runId: string,
): Promise<Map<string, ContractEventDto[]>> {
  const { params, where } = await scope(context, environmentSlug);
  params.push(runId);
  const run = `$${params.length}::uuid`;
  const keyed = `SELECT CASE WHEN e.action_digest IS NOT NULL
                   THEN 'action:' || e.action_digest
                   ELSE 'step:' || coalesce(e.step, '') END AS key, e.id`;
  const rows = parseRows(
    eventRow.extend({ key: z.string() }),
    await context.manager.query(
      `${SELECT.replace("SELECT e.id", keyed)}
       WHERE ${where} AND e.authority = 'authoritative' AND ${EXCHANGES}
         AND (e.run_id = ${run} OR e.action_digest IN (
           SELECT ar.action_digest FROM nodrail.action_requests ar
           WHERE ar.workspace_id = e.workspace_id AND ar.run_id = ${run}))
       ORDER BY e.occurred_at, e.id
       LIMIT 1000`,
      params,
    ),
  );
  return grouped(rows, context.principal.userId);
}
