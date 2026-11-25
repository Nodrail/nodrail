import "server-only";
import { z } from "zod";
import {
  surfaceCoverage,
  type ContractBindingChangeDto,
  type ContractBindingDto,
  type ContractRevisionDto,
  type ContractSurface,
  type ProjectedField,
  type ProjectionRevisionDto,
} from "@/contracts/v1/declared-contracts";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import type {
  ResolvedProperty,
  ResolvedShape,
} from "@/contracts/v1/shapes-engine";
import {
  AppError,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * Published contracts, read (C06, C07): what each binding of a workspace
 * revision attaches, one revision by its digest, and what changes between
 * two revisions: bindings, disclosure and whether a value accepted before
 * may now be refused. Any member reads projections; a full schema, whose
 * descriptions may be private, only those who may write policies.
 */

const bindingRow = z.object({
  surface: z.string(),
  target: z.string(),
  contract_digest: z.string(),
  projection_digest: z.string().nullable(),
  name: z.string().nullable(),
  pinned: z.boolean(),
  projected: z.boolean(),
});

async function bindingsAt(
  context: WorkspaceContext,
  where: { environmentId: string; projectId: string; revision: string },
) {
  return parseRows(
    bindingRow,
    await context.manager.query(
      `SELECT b.surface, b.target, b.contract_digest, b.projection_digest,
              coalesce(r.name, p.name) AS name, r.id IS NOT NULL AS pinned,
              p.id IS NOT NULL AS projected
       FROM nodrail.contract_bindings b
       LEFT JOIN nodrail.contract_revisions r
         ON r.workspace_id = b.workspace_id AND r.surface = b.surface
        AND r.digest = b.contract_digest
       LEFT JOIN nodrail.contract_projections p
         ON p.workspace_id = b.workspace_id AND p.surface = b.surface
        AND p.digest = b.projection_digest
       WHERE b.workspace_id = $1 AND b.environment_id = $2
         AND b.project_id = $3 AND b.workspace_revision = $4
       ORDER BY b.surface, b.target`,
      [
        context.workspaceId,
        where.environmentId,
        where.projectId,
        where.revision,
      ],
    ),
  );
}

/** The project's intended revision here, when none is named. */
async function intended(
  context: WorkspaceContext,
  environmentId: string,
  projectId: string,
) {
  const [row]: { revision: string }[] = await context.manager.query(
    `SELECT revision FROM nodrail.intended_revisions
     WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3`,
    [context.workspaceId, environmentId, projectId],
  );
  return row?.revision ?? null;
}

/**
 * Each binding of a published workspace revision: the project's intended
 * one unless `revision` names another. Empty when nothing is bound.
 */
export async function listContractBindings(
  context: WorkspaceContext,
  environmentSlug: string,
  query: { project_id: string; revision?: string | undefined },
): Promise<ContractBindingDto[]> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const revision =
    query.revision ??
    (await intended(context, environment.id, query.project_id));
  if (!revision) return [];
  const rows = await bindingsAt(context, {
    environmentId: environment.id,
    projectId: query.project_id,
    revision,
  });
  return rows.map((row) => {
    const surface = row.surface as ContractSurface;
    return {
      surface,
      coverage: surfaceCoverage[surface],
      target: row.target,
      contract: {
        name: row.name ?? "",
        digest: row.contract_digest,
        availability: row.pinned
          ? "pinned"
          : row.projected
            ? "projection_only"
            : "unavailable",
      },
      projectionDigest: row.projection_digest,
    };
  });
}

const revisionRow = z.object({
  surface: z.string(),
  digest: z.string(),
  name: z.string(),
  dialect: z.number(),
  property_count: z.number(),
  schema: resolvedShape,
  display_name: z.string().nullable(),
  created_at: z.date(),
});

const projectionRow = z.object({
  surface: z.string(),
  digest: z.string(),
  contract_digest: z.string(),
  name: z.string(),
  dialect: z.number(),
  schema: resolvedShape,
  withheld: z.array(z.string()),
  fields: z.array(z.custom<ProjectedField>()),
  registered_via: z.enum(["publish", "report"]),
  created_at: z.date(),
});

/**
 * A contract revision and its projections, or a projection, by digest.
 * The full shape only for people who may write policies.
 */
export async function getContract(
  context: WorkspaceContext,
  digest: string,
  surface?: ContractSurface,
): Promise<{
  contract: ContractRevisionDto | null;
  projections: ProjectionRevisionDto[];
}> {
  requireCapability(context, "workspace:read");
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new AppError("NOT_FOUND");
  const params = [context.workspaceId, digest, surface ?? null];
  const [revision] = parseRows(
    revisionRow,
    await context.manager.query(
      `SELECT r.surface, r.digest, r.name, r.dialect, r.property_count,
              r.schema, u.display_name, r.created_at
       FROM nodrail.contract_revisions r
       LEFT JOIN nodrail.users u ON u.id = r.registered_by
       WHERE r.workspace_id = $1 AND r.digest = $2
         AND ($3::text IS NULL OR r.surface = $3)
       ORDER BY r.created_at LIMIT 1`,
      params,
    ),
  );
  const projections = parseRows(
    projectionRow,
    await context.manager.query(
      `SELECT surface, digest, contract_digest, name, dialect, schema,
              withheld, fields, registered_via, created_at
       FROM nodrail.contract_projections
       WHERE workspace_id = $1 AND (digest = $2 OR contract_digest = $2)
         AND ($3::text IS NULL OR surface = $3)
       ORDER BY created_at LIMIT 50`,
      params,
    ),
  );
  if (!revision && projections.length === 0) throw new AppError("NOT_FOUND");
  const readsSchema = context.capabilities.has("policies:write");
  return {
    contract: revision
      ? {
          digest: revision.digest,
          name: revision.name,
          surface: revision.surface as ContractSurface,
          dialect: revision.dialect,
          propertyCount: revision.property_count,
          shape: readsSchema ? revision.schema : null,
          registeredBy: revision.display_name ?? "",
          createdAt: revision.created_at.toISOString(),
        }
      : null,
    projections: projections.map((row) => ({
      digest: row.digest,
      contractDigest: row.contract_digest,
      name: row.name,
      surface: row.surface as ContractSurface,
      dialect: row.dialect,
      shape: row.schema,
      withheld: row.withheld,
      fields: row.fields,
      registeredVia: row.registered_via,
      createdAt: row.created_at.toISOString(),
    })),
  };
}

// ── Compatibility ──────────────────────────────────────────────────────────

type Bounded = { min: number | string | null; max: number | string | null };

/** A lower minimum or a higher maximum is wider; null is no bound. */
const tighter = (was: Bounded, now: Bounded) =>
  (now.min !== null && (was.min === null || now.min > was.min)) ||
  (now.max !== null && (was.max === null || now.max < was.max));

/**
 * Whether a value the older property accepts may be refused by the newer:
 * another type, now required, fewer enum values, tighter bounds, another
 * unit, or the same of what it holds.
 */
function refusesMore(was: ResolvedProperty, now: ResolvedProperty): boolean {
  if (was.type !== now.type) return true;
  if (was.optional && !now.optional) return true;
  if (now.type === "enum")
    return (was as typeof now).values.some((v) => !now.values.includes(v));
  if (now.type === "object")
    return mapRefusesMore((was as typeof now).properties, now.properties);
  if (now.type === "boolean") return false;
  const before = was as typeof now;
  if (tighter(before, now)) return true;
  if (now.type === "list")
    return refusesMore((before as typeof now).of, now.of);
  return (
    (now.type === "integer" || now.type === "number") &&
    (before as typeof now).unit !== now.unit
  );
}

function mapRefusesMore(
  was: Record<string, ResolvedProperty>,
  now: Record<string, ResolvedProperty>,
) {
  // A removed property is now unknown, and refused.
  if (Object.keys(was).some((name) => !Object.hasOwn(now, name))) return true;
  return Object.entries(now).some(([name, property]) =>
    Object.hasOwn(was, name)
      ? refusesMore(was[name]!, property)
      : !property.optional,
  );
}

const breaking = (was: ResolvedShape, now: ResolvedShape) =>
  mapRefusesMore(was.properties, now.properties);

async function fullShapes(context: WorkspaceContext, digests: string[]) {
  const rows: { digest: string; schema: ResolvedShape }[] =
    await context.manager.query(
      `SELECT DISTINCT ON (digest) digest, schema
       FROM nodrail.contract_revisions
       WHERE workspace_id = $1 AND digest = ANY($2)`,
      [context.workspaceId, digests],
    );
  return new Map(rows.map((row) => [row.digest, row.schema]));
}

async function projectedPaths(context: WorkspaceContext, digests: string[]) {
  const rows: { digest: string; fields: ProjectedField[] }[] =
    await context.manager.query(
      `SELECT DISTINCT ON (digest) digest, fields
       FROM nodrail.contract_projections
       WHERE workspace_id = $1 AND digest = ANY($2)`,
      [context.workspaceId, digests],
    );
  return new Map(
    rows.map((row) => [row.digest, row.fields.map((field) => field.path)]),
  );
}

type Binding = Awaited<ReturnType<typeof bindingsAt>>[number];

/**
 * What changes between two published workspace revisions of a project:
 * each binding added, removed, revised or unchanged; the reported fields a
 * viewer would newly see or stop seeing; and whether the change is
 * breaking. Compatibility is `unknown` when a full schema isn't pinned.
 */
export async function diffContracts(
  context: WorkspaceContext,
  environmentSlug: string,
  query: { project_id: string; from: string; to: string },
): Promise<ContractBindingChangeDto[]> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const at = (revision: string) =>
    bindingsAt(context, {
      environmentId: environment.id,
      projectId: query.project_id,
      revision,
    });
  const [before, after] = await Promise.all([at(query.from), at(query.to)]);
  const key = (b: Binding) => `${b.surface} ${b.target}`;
  const was = new Map(before.map((b) => [key(b), b]));
  const now = new Map(after.map((b) => [key(b), b]));
  const all = [...before, ...after];
  const shapes = await fullShapes(
    context,
    all.map((b) => b.contract_digest),
  );
  const paths = await projectedPaths(
    context,
    all.flatMap((b) => b.projection_digest ?? []),
  );
  const reported = (b: Binding | undefined) =>
    (b?.projection_digest && paths.get(b.projection_digest)) || [];
  const keys = [...new Set([...was.keys(), ...now.keys()])].sort();
  return keys.map((k) => {
    const old = was.get(k);
    const next = now.get(k);
    const one = (next ?? old)!;
    const seen = reported(old);
    const shown = reported(next);
    return {
      surface: one.surface as ContractSurface,
      target: one.target,
      change: !old
        ? "added"
        : !next
          ? "removed"
          : old.contract_digest === next.contract_digest
            ? "unchanged"
            : "revised",
      before: old?.contract_digest ?? null,
      after: next?.contract_digest ?? null,
      disclosure: {
        added: shown.filter((path) => !seen.includes(path)),
        removed: seen.filter((path) => !shown.includes(path)),
      },
      compatibility: compatibility(shapes, old, next),
    };
  });
}

function compatibility(
  shapes: Map<string, ResolvedShape>,
  old: Binding | undefined,
  next: Binding | undefined,
): ContractBindingChangeDto["compatibility"] {
  // A new binding validates what nothing validated before; dropping one
  // refuses nothing.
  if (!old) return "breaking";
  if (!next || old.contract_digest === next.contract_digest)
    return "compatible";
  const was = shapes.get(old.contract_digest);
  const now = shapes.get(next.contract_digest);
  if (!was || !now) return "unknown";
  return breaking(was, now) ? "breaking" : "compatible";
}
