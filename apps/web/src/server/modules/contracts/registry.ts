import "server-only";
import {
  MAX_REVISIONS_PER_WORKSPACE,
  projectionRevisionInput,
  type ContractClosureInput,
  type ContractSurface,
  type ProjectedField,
  type ProjectionRevisionInput,
} from "@/contracts/v1/declared-contracts";
import { measureShape } from "@/contracts/v1/resolved-shape";
import {
  CONTRACT_DIALECT,
  contractDigest,
  projectShape,
  type ReceiptContract,
  type ResolvedProperty,
  type ResolvedShape,
} from "@/contracts/v1/shapes-engine";
import {
  AppError,
  parseInput,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";

/**
 * Contract and projection revisions: content named by the
 * engine's digest, recomputed here with the engine's own code before
 * anything is kept, so a sender can't name one content and store another.
 * Revisions are only added, never changed; the same content twice is one.
 */

const LEAVES = new Set([
  "string",
  "integer",
  "number",
  "boolean",
  "enum",
  "date",
]);

/**
 * What views and Insights may select from a projected shape: its scalar
 * leaves by dotted path. Lists are never entered, as in `where`.
 */
export function projectedFields(shape: ResolvedShape): ProjectedField[] {
  const fields: ProjectedField[] = [];
  const visit = (
    properties: Record<string, ResolvedProperty>,
    prefix: string,
  ) => {
    for (const [name, property] of Object.entries(properties)) {
      const path = prefix ? `${prefix}.${name}` : name;
      if (property.type === "object") visit(property.properties, path);
      if (!LEAVES.has(property.type)) continue;
      fields.push({
        path,
        type: property.type as ProjectedField["type"],
        ...(property.type === "enum" ? { values: property.values } : {}),
        ...(property.role ? { role: property.role } : {}),
        ...((property.type === "integer" || property.type === "number") &&
        property.unit
          ? { unit: property.unit }
          : {}),
        optional: property.optional,
      });
    }
  };
  visit(shape.properties, "");
  return fields;
}

/** The engine's projection digest of what was sent; refused unless equal. */
function verifyProjection(input: ProjectionRevisionInput) {
  const digest = contractDigest("projection", {
    shape: input.shape,
    withheld: input.withheld,
  });
  if (digest !== input.digest) throw new AppError("INVALID_INPUT");
}

/** One workspace keeps at most this many of each; the same content is free. */
async function withinCap(
  context: WorkspaceContext,
  table: "contract_revisions" | "contract_projections",
  surface: ContractSurface,
  digest: string,
) {
  const [row]: { known: boolean; total: number }[] =
    await context.manager.query(
      `SELECT EXISTS (SELECT 1 FROM nodrail.${table}
                      WHERE workspace_id = $1 AND surface = $2 AND digest = $3)
                AS known,
              (SELECT count(*)::int FROM nodrail.${table}
               WHERE workspace_id = $1) AS total`,
      [context.workspaceId, surface, digest],
    );
  if (!row!.known && row!.total >= MAX_REVISIONS_PER_WORKSPACE)
    throw new AppError("QUOTA_EXCEEDED");
  return !row!.known;
}

async function keepProjection(
  context: WorkspaceContext,
  input: ProjectionRevisionInput,
  via: "publish" | "report",
) {
  const added = await withinCap(
    context,
    "contract_projections",
    input.surface,
    input.digest,
  );
  if (!added) return false;
  const rows: unknown[] = await context.manager.query(
    `INSERT INTO nodrail.contract_projections
       (workspace_id, surface, digest, contract_digest, name, dialect, schema,
        fields, withheld, registered_via, registered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT ON CONSTRAINT contract_projections_digest DO NOTHING
     RETURNING id`,
    [
      context.workspaceId,
      input.surface,
      input.digest,
      input.contract_digest,
      input.name,
      input.dialect,
      JSON.stringify(input.shape),
      JSON.stringify(projectedFields(input.shape)),
      JSON.stringify(input.withheld),
      via,
      context.principal.userId,
    ],
  );
  return rows.length > 0;
}

/**
 * Registers a projection a reporting client is about to report against
 * (`inventory:write`). Idempotent: `registered` is false when the same
 * content was already here. Its descriptions are only reported ones, and
 * it never stands for the full contract.
 */
export async function registerProjection(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<{ registered: boolean }> {
  requireCapability(context, "workspace:read");
  const input = parseInput(projectionRevisionInput, rawInput);
  verifyProjection(input);
  return { registered: await keepProjection(context, input, "report") };
}

/**
 * Pins one full revision (its digest recomputed) and the projection the
 * engine derives from it; returns the projection's digest. Only a publish
 * (`policies:write`) does this: a workspace revision's closure, or the
 * receipts a rules file declares.
 */
async function pinRevision(
  context: WorkspaceContext,
  revision: ContractClosureInput["revisions"][number],
) {
  requireCapability(context, "policies:write");
  if (contractDigest("shape", revision.shape) !== revision.digest)
    throw new AppError("INVALID_INPUT");
  const { named } = measureShape(revision.shape.properties);
  if (named < 1) throw new AppError("INVALID_INPUT");
  if (
    await withinCap(
      context,
      "contract_revisions",
      revision.surface,
      revision.digest,
    )
  )
    await context.manager.query(
      `INSERT INTO nodrail.contract_revisions
         (workspace_id, surface, digest, name, dialect, property_count,
          schema, registered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ON CONSTRAINT contract_revisions_digest DO NOTHING`,
      [
        context.workspaceId,
        revision.surface,
        revision.digest,
        revision.name,
        revision.dialect,
        named,
        JSON.stringify(revision.shape),
        context.principal.userId,
      ],
    );
  const projection = projectShape(revision.shape);
  await keepProjection(
    context,
    {
      digest: projection.digest,
      contract_digest: revision.digest,
      name: revision.name,
      surface: revision.surface,
      dialect: CONTRACT_DIALECT,
      shape: projection.shape,
      withheld: projection.withheld,
    },
    "publish",
  );
  return projection.digest;
}

/** A declared contract as a rules file's compiled document carries it. */
type Declared = { name: string; contract: string; shape: ResolvedShape };

/**
 * Pins the contracts a rules file declares (document version 3): receipts,
 * briefs and operation inputs, so what Cloud reads them with, and the
 * events it keeps, name stored revisions; a brief or input submitted on
 * the runtime path is validated against these. An input's revision is
 * named by its shape, as the file names it (`inputShapes`), else by its
 * operation (`stripe.refund` is `stripe-refund`). Inside the publish
 * transaction.
 */
export async function pinPolicyContracts(
  context: WorkspaceContext,
  declared: {
    receipts?: Record<string, ReceiptContract>;
    briefs?: Record<string, Declared>;
    inputs?: Record<string, Declared>;
  },
  inputShapes: Map<string, string>,
) {
  const pinned = new Set<string>();
  const pin = async (
    surface: ContractSurface,
    name: string,
    contract: Declared,
  ) => {
    if (pinned.has(`${surface}:${contract.contract}`)) return;
    pinned.add(`${surface}:${contract.contract}`);
    await pinRevision(context, {
      digest: contract.contract,
      name,
      surface,
      dialect: CONTRACT_DIALECT,
      shape: contract.shape,
    });
  };
  for (const receipt of Object.values(declared.receipts ?? {}))
    await pin("receipt", receipt.name, receipt);
  for (const brief of Object.values(declared.briefs ?? {}))
    await pin("brief", brief.name, brief);
  for (const [key, input] of Object.entries(declared.inputs ?? {}))
    await pin(
      "tool_input",
      inputShapes.get(key) ?? key.replace(/[^a-z0-9-]/g, "-").slice(0, 63),
      input,
    );
}

/**
 * Pins a published workspace revision's contracts: each full revision and
 * its projection, then the bindings. Inside the publish transaction.
 */
export async function pinContracts(
  context: WorkspaceContext,
  where: {
    environmentId: string;
    projectId: string;
    workspaceRevision: string;
  },
  closure: ContractClosureInput,
) {
  requireCapability(context, "policies:write");
  const projections = new Map<string, string>();
  for (const revision of closure.revisions)
    projections.set(
      `${revision.surface}:${revision.digest}`,
      await pinRevision(context, revision),
    );
  for (const binding of closure.bindings)
    await context.manager.query(
      `INSERT INTO nodrail.contract_bindings
         (workspace_id, environment_id, project_id, workspace_revision,
          surface, target, contract_digest, projection_digest, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ON CONSTRAINT contract_bindings_target DO NOTHING`,
      [
        context.workspaceId,
        where.environmentId,
        where.projectId,
        where.workspaceRevision,
        binding.surface,
        binding.target,
        binding.contract_digest,
        projections.get(`${binding.surface}:${binding.contract_digest}`),
        context.principal.userId,
      ],
    );
}
