import { z } from "zod";
import { resolvedShape } from "./resolved-shape";
import {
  CONTRACT_DIALECT,
  LIMITS,
  PAYLOAD_BYTES,
  PROPERTY_NAME,
  SHAPE_NAME,
  type ResolvedShape,
  type Role,
  type SurfaceId,
} from "./shapes-engine";

/**
 * Declared contracts in Cloud and self-hosted deployments: the immutable
 * contracts and reporting projections a workspace knows, their bindings, and the
 * validated events that name them. The grammar is the policy engine's
 * (packages/policy-engine/docs/contracts.md): a resolved shape here is the
 * engine's, and its digest is the engine's, recomputed by the server before
 * anything is kept.
 *
 * Reported and authoritative stay apart. A `reported` event came from an
 * installation's local hook over the reporting token: evidence only, never a
 * permission or a Cloud gate. Only an `authoritative` event,
 * submitted on the Cloud runtime path and validated by the server against
 * the pinned full contract, can be read by anything that authorizes.
 */

// ── Limits ─────────────────────────────────────────────────────────────────

/** A resolved full contract, as canonical JSON. */
export const MAX_CONTRACT_SCHEMA_BYTES = 64 * 1024;
/** A reporting projection: only the properties that may leave a machine. */
export const MAX_PROJECTION_SCHEMA_BYTES = 32 * 1024;
/** The engine's ceiling on named properties across a resolved shape. */
export const MAX_SHAPE_PROPERTIES = LIMITS.properties;
/** The engine's ceiling on nesting. */
export const MAX_SHAPE_DEPTH = LIMITS.depth;
/** A receipt message is at most 8 KiB, so its projection is too. */
export const MAX_EVENT_PAYLOAD_BYTES = PAYLOAD_BYTES.receipt;
/** Issues kept per event; the count says how many there were. */
export const MAX_STORED_ISSUES = 20;
/** Paths a projection withholds. */
export const MAX_REDACTED_PATHS = MAX_SHAPE_PROPERTIES;
/** Distinct contract or projection revisions one workspace may keep. */
export const MAX_REVISIONS_PER_WORKSPACE = 1000;
/** Bindings one published workspace revision may declare. */
export const MAX_BINDINGS_PER_REVISION = 500;
/** Events one OTLP export or runtime batch may carry. */
export const MAX_EVENTS_PER_BATCH = 200;
/** A page of events. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** Insights: filters, groups and the window an aggregation may span. */
export const MAX_SELECTOR_FILTERS = 3;
export const MAX_SELECTOR_GROUPS = 50;
export const MAX_SELECTOR_DAYS = 90;
/** Events and the revisions they name are kept a year, like local runs. */
export const CONTRACT_RETENTION_DAYS = 365;
/**
 * The reporting schema that carries `nodrail.contract.event` spans.
 * A contract span under an older schema is counted as rejected.
 */
export const CONTRACT_REPORTING_SCHEMA = "3";

// ── Identity ───────────────────────────────────────────────────────────────

/**
 * The engine's digest: `sha256:` and the hex SHA-256 of a domain tag
 * (`nodrail:<domain>:v1`, a newline) and the RFC 8785 canonical JSON of what
 * it pins. Full length; a display prefix is never identity.
 */
export const contractDigest = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** A shape's registry name, as the grammar allows it. */
export const contractName = z.string().regex(SHAPE_NAME, "a shape name");

/**
 * The grammar version a revision was resolved and digested under. Cloud
 * recomputes digests with the engine it ships, so it takes only that one.
 */
export const contractDialect = z.literal(CONTRACT_DIALECT);

/**
 * Where a contract attaches, one per coverage surface. Readers consume
 * events from these surfaces.
 */
export const contractSurfaces = [
  "receipt",
  "brief",
  "tool_input",
  "tool_result",
  "evidence",
  "memory_record",
  "file",
  "inventory_metadata",
] as const;
export type ContractSurface = (typeof contractSurfaces)[number];

export const surfaceCoverage: Record<ContractSurface, SurfaceId> = {
  receipt: "S01",
  brief: "S02",
  tool_input: "S03",
  tool_result: "S04",
  evidence: "S05",
  memory_record: "S06",
  file: "S07",
  inventory_metadata: "S09",
};

/**
 * The binding names each surface's attachments take in plans, locks and
 * test cases: `receipt:qa`, `input:stripe.refund`, `inventory`. A memory write's input is the record, so S06 takes both.
 */
export const bindingKinds: Record<ContractSurface, readonly string[]> = {
  receipt: ["receipt"],
  brief: ["brief"],
  tool_input: ["input"],
  tool_result: ["output"],
  evidence: ["evidence"],
  memory_record: ["memory", "input"],
  file: ["file"],
  inventory_metadata: ["inventory"],
};

/** A binding name: `<kind>:<name>`, or `inventory` alone. */
export const bindingName = z
  .string()
  .max(140)
  .regex(/^(?:inventory|[a-z]+:[a-z0-9_.-]{1,130})$/, "a binding name");

/** Whether a binding name belongs to a surface. */
export const bindsSurface = (surface: ContractSurface, name: string) =>
  bindingKinds[surface].includes(name.split(":")[0]!);

/** A property name, as a fragment to build path patterns from. */
const propertyName = PROPERTY_NAME.source.slice(1, -1);

/**
 * A path into a resolved shape: property names joined by dots, no deeper
 * than the grammar allows, never into a list. Selectors and conditions use
 * these.
 */
export const shapePath = z
  .string()
  .max(255)
  .regex(
    new RegExp(`^${propertyName}(\\.${propertyName}){0,${LIMITS.depth - 1}}$`),
    "a declared property path",
  );

/**
 * A path to where validation failed, which may step into a list item by its
 * index: `items.3.name`. Never a value.
 */
export const issuePath = z
  .string()
  .max(255)
  .regex(
    new RegExp(
      `^${propertyName}(\\.(${propertyName}|[0-9]{1,2})){0,${2 * LIMITS.depth - 1}}$`,
    ),
    "a property path",
  );

// ── Revisions, projections and bindings (publish path) ─────────────────────

/** The reportable type of a projected property: what a selector may use. */
export const fieldTypes = [
  "string",
  "integer",
  "number",
  "boolean",
  "enum",
  "date",
] as const;

/**
 * One property a projection discloses, as views and Insights may select
 * it. Derived by the server from the projected shape, never sent.
 */
export type ProjectedField = {
  path: string;
  type: (typeof fieldTypes)[number];
  /** Allowed values of an enum, from the schema; never observed values. */
  values?: string[];
  /** The role the grammar gave it, if any. */
  role?: Role;
  /** A number's unit; equal units are the only compatible ones. */
  unit?: string;
  optional: boolean;
};

/**
 * A full contract revision: the engine's resolved shape, whose `for` texts
 * may be private, so it arrives only on the publish path (`rules:write`).
 * The server recomputes its digest and counts its properties.
 */
export const contractRevisionInput = z
  .object({
    digest: contractDigest,
    name: contractName,
    surface: z.enum(contractSurfaces),
    dialect: contractDialect,
    shape: resolvedShape,
  })
  .strict();
export type ContractRevisionInput = z.infer<typeof contractRevisionInput>;

/**
 * A reporting projection of one contract revision: the reported properties
 * with their types, bounds and `for` text, and the withheld paths by name
 * only. It arrives before the first report that names it, or is derived by
 * the server on publish; either way its digest is recomputed, so who sent
 * it doesn't change what it is. Its contract digest is the sender's word
 * until a publish pins both.
 */
export const projectionRevisionInput = z
  .object({
    digest: contractDigest,
    contract_digest: contractDigest,
    name: contractName,
    surface: z.enum(contractSurfaces),
    dialect: contractDialect,
    shape: resolvedShape,
    withheld: z
      .array(shapePath)
      .max(MAX_REDACTED_PATHS)
      .refine((paths) => new Set(paths).size === paths.length, "each once")
      // As the engine digests them since #110: a set, in sorted order, so
      // one content has one projection digest.
      .refine(
        (paths) => paths.every((path, i) => i === 0 || paths[i - 1]! < path),
        "sorted",
      ),
  })
  .strict();
export type ProjectionRevisionInput = z.infer<typeof projectionRevisionInput>;

/**
 * Where a revision is attached in one published workspace revision: the
 * engine's binding name (`receipt:reviewer`, `input:stripe.refund`).
 */
export const contractBindingInput = z
  .object({
    surface: z.enum(contractSurfaces),
    target: bindingName,
    contract_digest: contractDigest,
  })
  .strict()
  .refine((binding) => bindsSurface(binding.surface, binding.target), {
    path: ["target"],
    message: "a binding name of this surface",
  });

/**
 * What `nodrail workspace publish` adds to its body as `contracts`: the
 * lock's contract closure for that workspace revision. Optional, so older
 * clients keep publishing as before. The server derives each revision's
 * projection with the engine, so the closure never sends one to trust.
 */
export const contractClosureInput = z
  .object({
    revisions: z.array(contractRevisionInput).max(MAX_BINDINGS_PER_REVISION),
    bindings: z.array(contractBindingInput).max(MAX_BINDINGS_PER_REVISION),
  })
  .strict()
  .superRefine((closure, context) => {
    const full = new Set(
      closure.revisions.map((r) => `${r.surface}:${r.digest}`),
    );
    closure.bindings.forEach((binding, index) => {
      if (!full.has(`${binding.surface}:${binding.contract_digest}`))
        context.addIssue({
          code: "custom",
          path: ["bindings", index, "contract_digest"],
          message: "a revision in this closure",
        });
    });
  });
export type ContractClosureInput = z.infer<typeof contractClosureInput>;

/** Whether Cloud holds a contract's full schema or only what it reports. */
export const schemaAvailability = [
  /** Published: the full resolved schema is pinned here. */
  "pinned",
  /** Only the reporting projection is here; the full schema stayed local. */
  "projection_only",
  /** Neither, or no longer: retention removed it, or it never arrived. */
  "unavailable",
] as const;
export type SchemaAvailability = (typeof schemaAvailability)[number];

export type ContractRevisionDto = {
  digest: string;
  name: string;
  surface: ContractSurface;
  dialect: number;
  propertyCount: number;
  /** Shown only to people who may read schemas (`policies:write`). */
  shape: ResolvedShape | null;
  registeredBy: string;
  createdAt: string;
};

export type ProjectionRevisionDto = {
  digest: string;
  contractDigest: string;
  name: string;
  surface: ContractSurface;
  dialect: number;
  /** The reported properties, with their `for` text: nothing else leaves. */
  shape: ResolvedShape;
  /** Withheld paths, by name only. */
  withheld: string[];
  fields: ProjectedField[];
  registeredVia: "publish" | "report";
  createdAt: string;
};

export type ContractBindingDto = {
  surface: ContractSurface;
  coverage: SurfaceId;
  target: string;
  contract: { name: string; digest: string; availability: SchemaAvailability };
  projectionDigest: string | null;
};

/** One binding's change between two published workspace revisions. */
export type ContractBindingChangeDto = {
  surface: ContractSurface;
  target: string;
  change: "added" | "removed" | "revised" | "unchanged";
  before: string | null;
  after: string | null;
  /** Properties a viewer would newly see or stop seeing in reports. */
  disclosure: { added: string[]; removed: string[] };
  /** The engine's compatibility class; `unknown` until it says. */
  compatibility: "compatible" | "breaking" | "unknown";
};
