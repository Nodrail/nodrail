import {
  Check,
  Column,
  Entity,
  Generated,
  Index,
  Unique,
  type Relation,
} from "typeorm";
import type { SafeValidationIssue } from "@/contracts/v1/contract-events";
import type { ProjectedField } from "@/contracts/v1/declared-contracts";
import {
  Clock,
  Fk,
  Id,
  Int,
  OptionalText,
  OptionalUuid,
  Text,
  Time,
  Uuid,
  inWorkspace,
  member,
  schema,
} from "./columns";
import { EvidenceVerifier } from "./evidence-entities";
import { PublishedToEnvironment } from "./published-base";
import { Environment, Installation, WorkspaceMembership } from "./entities";

/**
 * Declared contracts. Revisions and projections are
 * content-addressed and immutable: a digest names one content forever, so
 * the application may add them and never change them; retention removes
 * one only once no event or binding names it.
 */

/**
 * A JSON object column. The contracts check it is plain, bounded JSON
 * before it gets here; a recursive JSON type would defeat TypeORM's
 * partial-entity types.
 */
type JsonObject = Record<string, unknown>;

const sha256 = (column: string) => `"${column}" ~ '^sha256:[0-9a-f]{64}$'`;
const surfaces = `'receipt', 'brief', 'tool_input', 'tool_result', 'evidence', 'memory_record', 'file', 'inventory_metadata'`;
const surface = `"surface" IN (${surfaces})`;
const name = `"name" ~ '^[a-z][a-z0-9-]{0,62}$'`;
const dialect = `"dialect" BETWEEN 1 AND 999`;

/**
 * What a full revision and a projection share: content named by its
 * digest, and the member whose publish or report first brought it.
 */
abstract class Registered {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Text() surface!: string;
  /** The engine's canonical digest, recomputed by the server. */
  @Text() digest!: string;
  @Text() name!: string;
  /** The grammar's dialect the digest was computed under. */
  @Int() dialect!: number;
  /** The engine's resolved shape: the full one, or the projected one. */
  @Column({ type: "jsonb" }) schema!: JsonObject;
  @Uuid() registeredBy!: string;
  @Clock() createdAt!: Date;
  @Fk(() => WorkspaceMembership, member("registered_by"))
  registrar!: Relation<WorkspaceMembership>;
}

/**
 * A full contract revision, pinned: the engine's resolved shape, as
 * published with a workspace revision. Its descriptions may be private,
 * so only the publish path (`rules:write`) adds one; a local report never
 * uploads it.
 */
@Entity({ schema, name: "contract_revisions" })
@Unique("contract_revisions_digest", ["workspaceId", "surface", "digest"])
@Check("contract_revisions_digest_format", sha256("digest"))
@Check("contract_revisions_surface", surface)
@Check("contract_revisions_name", name)
@Check("contract_revisions_dialect", dialect)
@Check("contract_revisions_properties", `"property_count" BETWEEN 1 AND 64`)
@Check(
  "contract_revisions_schema",
  `jsonb_typeof("schema") = 'object' AND length("schema"::text) <= 65536`,
)
export class ContractRevision extends Registered {
  @Int() propertyCount!: number;
}

/**
 * A reporting projection of one contract revision: only what may leave a
 * machine, and the fields Insights may select. It names its full contract
 * by digest, not by key: the full schema may never be in Cloud.
 */
@Entity({ schema, name: "contract_projections" })
@Unique("contract_projections_digest", ["workspaceId", "surface", "digest"])
@Index("contract_projections_by_contract", [
  "workspaceId",
  "surface",
  "contractDigest",
])
@Check(
  "contract_projections_digests",
  `${sha256("digest")} AND ${sha256("contract_digest")}`,
)
@Check("contract_projections_surface", surface)
@Check("contract_projections_name", name)
@Check("contract_projections_dialect", dialect)
@Check(
  "contract_projections_schema",
  `jsonb_typeof("schema") = 'object' AND length("schema"::text) <= 32768`,
)
@Check(
  "contract_projections_fields",
  `jsonb_typeof("fields") = 'array' AND jsonb_array_length("fields") <= 64 AND length("fields"::text) <= 16384`,
)
@Check(
  "contract_projections_withheld",
  `jsonb_typeof("withheld") = 'array' AND jsonb_array_length("withheld") <= 64 AND length("withheld"::text) <= 4096`,
)
@Check(
  "contract_projections_registered_via",
  `"registered_via" IN ('publish', 'report')`,
)
export class ContractProjection extends Registered {
  /** The full revision it projects, by digest. */
  @Text() contractDigest!: string;
  /** Derived from the projected shape by the server: what views may select. */
  @Column({ type: "jsonb" }) fields!: ProjectedField[];
  /** Paths the projection leaves out, by name only; part of its digest. */
  @Column({ type: "jsonb", default: () => "'[]'" }) withheld!: string[];
  /** How it first arrived; its content is the same either way. */
  @Text() registeredVia!: "publish" | "report";
}

/**
 * Where one published workspace revision attaches a contract: the engine's
 * attachment location, the full revision and its projection. A revision's
 * bindings are fixed by its digest, so they are only added.
 */
@Entity({ schema, name: "contract_bindings" })
@Unique("contract_bindings_target", [
  "workspaceId",
  "environmentId",
  "projectId",
  "workspaceRevision",
  "surface",
  "target",
])
@Check(
  "contract_bindings_digests",
  `"workspace_revision" ~ '^[0-9a-f]{64}$' AND ${sha256("contract_digest")} AND ("projection_digest" IS NULL OR ${sha256("projection_digest")})`,
)
@Check("contract_bindings_surface", surface)
@Check(
  "contract_bindings_target_format",
  `length("target") <= 140 AND "target" ~ '^(inventory|[a-z]+:[a-z0-9_.-]{1,130})$'`,
)
export class ContractBinding extends PublishedToEnvironment {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Uuid() projectId!: string;
  /** The lock's workspace digest these bindings belong to. */
  @Text() workspaceRevision!: string;
  @Text() surface!: string;
  @Text() target!: string;
  @Text() contractDigest!: string;
  @OptionalText() projectionDigest!: string | null;
}

/** Columns no authoritative event, from an installation or a verifier, has. */
const NO_REPORTER = `"user_id" IS NULL AND "trace_id" IS NULL AND "span_id" IS NULL AND "machine" IS NULL AND "project_id" IS NULL AND "project" IS NULL AND "host" IS NULL AND "run" IS NULL`;

/**
 * Where an event came from, one branch each: a person's local report, the
 * Cloud runtime path from an installation, or a verifier's authenticated
 * evidence, externally verified by construction and naming no
 * installation, run or action.
 */
const CONTRACT_EVENT_SOURCES = `("authority" = 'reported' AND "verifier_id" IS NULL AND "user_id" IS NOT NULL AND "trace_id" IS NOT NULL AND "span_id" IS NOT NULL AND "project" IS NOT NULL AND "host" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NULL AND "run_id" IS NULL AND "action_digest" IS NULL AND "validated_by" IS DISTINCT FROM 'server' AND "producer_class" IN ('agent-reported', 'runtime-observed') AND "subject_source" IS DISTINCT FROM 'externally-verified') OR ("authority" = 'authoritative' AND "verifier_id" IS NULL AND "installation_id" IS NOT NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "validated_by" IS DISTINCT FROM 'producer') OR ("authority" = 'authoritative' AND "verifier_id" IS NOT NULL AND "installation_id" IS NULL AND "idempotency_key" IS NOT NULL AND ${NO_REPORTER} AND "run_id" IS NULL AND "action_digest" IS NULL AND "surface" = 'evidence' AND "evidence" IS NOT NULL AND "producer_class" = 'externally-verified' AND "subject_source" = 'externally-verified' AND "validated_by" = 'server' AND "provenance" IS NOT NULL AND "body_digest" IS NOT NULL)`;

/**
 * One exchange validated against a declared contract: its envelope, its
 * states and its projected values. The envelope is the runtime's or the
 * server's, never a receipt property's.
 *
 * `reported` rows are local evidence sent with a reporting token, by a
 * person from a machine: the installation's own validation, never read by
 * anything that authorizes. `authoritative` rows came on the Cloud runtime
 * path from an installation, or from a verifier's CI job, and were
 * validated by the server. The checks keep them from ever looking alike.
 */
@Entity({ schema, name: "contract_events" })
@Unique("contract_events_reported_once", ["workspaceId", "traceId", "spanId"])
@Unique("contract_events_runtime_once", [
  "workspaceId",
  "installationId",
  "idempotencyKey",
])
@Unique("contract_events_verified_once", [
  "workspaceId",
  "verifierId",
  "idempotencyKey",
])
@Index("contract_events_by_time", [
  "workspaceId",
  "environmentId",
  "occurredAt",
])
@Index("contract_events_by_contract", [
  "workspaceId",
  "environmentId",
  "surface",
  "contractDigest",
  "occurredAt",
])
@Index("contract_events_by_run", ["workspaceId", "environmentId", "run"])
@Index("contract_events_by_action", ["workspaceId", "actionDigest"])
@Index("contract_events_by_evidence", [
  "workspaceId",
  "environmentId",
  "evidence",
  "subjectRevision",
  "seq",
])
@Check("contract_events_surface", surface)
@Check(
  "contract_events_contract",
  `${sha256("contract_digest")} AND ("projection_digest" IS NULL OR ${sha256("projection_digest")}) AND "contract_name" ~ '^[a-z][a-z0-9-]{0,62}$'`,
)
@Check("contract_events_source", CONTRACT_EVENT_SOURCES)
@Check(
  "contract_events_verified",
  `("verifier_id" IS NOT NULL OR ("evidence" IS NULL AND "authorized_value" IS NULL AND "provenance" IS NULL AND ("body_digest" IS NULL OR "installation_id" IS NOT NULL))) AND ("evidence" IS NULL OR ("surface" = 'evidence' AND "evidence" ~ '^[a-z][a-z0-9-]{0,62}$')) AND ("authorized_value" IS NULL OR (jsonb_typeof("authorized_value") = 'object' AND length("authorized_value"::text) <= 16384 AND "validation" = 'valid')) AND ("provenance" IS NULL OR (jsonb_typeof("provenance") = 'object' AND length("provenance"::text) <= 2048)) AND ("body_digest" IS NULL OR "body_digest" ~ '^sha256:[0-9a-f]{64}$')`,
)
@Check(
  "contract_events_producer_class",
  `"producer_class" IN ('agent-reported', 'runtime-observed', 'externally-verified', 'person-authenticated')`,
)
@Check(
  "contract_events_ids",
  `("trace_id" IS NULL OR "trace_id" ~ '^[0-9a-f]{32}$') AND ("span_id" IS NULL OR "span_id" ~ '^[0-9a-f]{16}$') AND ("idempotency_key" IS NULL OR length("idempotency_key") BETWEEN 1 AND 128)`,
)
@Check(
  "contract_events_where",
  `("machine" IS NULL OR "machine" ~ '^[0-9a-f]{32}$') AND ("project" IS NULL OR length("project") BETWEEN 1 AND 200) AND ("host" IS NULL OR "host" ~ '^[a-z][a-z0-9-]{0,39}$') AND ("run" IS NULL OR "run" ~ '^[0-9a-f]{32}$') AND length("agent") <= 200 AND length("step") <= 200 AND ("action_digest" IS NULL OR ${sha256("action_digest")})`,
)
@Check(
  "contract_events_subject",
  `("subject_revision" IS NULL) = ("subject_source" IS NULL) AND ("subject_revision" IS NULL OR "subject_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64}|sha256:[0-9a-f]{64})$') AND ("subject_source" IS NULL OR "subject_source" IN ('runtime-observed', 'externally-verified'))`,
)
@Check(
  "contract_events_states",
  `"capture" IN ('captured', 'missing', 'unsupported') AND ("capture" = 'captured') = ("validation" IS NOT NULL AND "validated_by" IS NOT NULL AND "projection_digest" IS NOT NULL AND "projection_validation" IS NOT NULL) AND ("validation" IS NULL OR "validation" IN ('valid', 'invalid')) AND ("validated_by" IS NULL OR "validated_by" IN ('producer', 'server')) AND ("projection_validation" IS NULL OR "projection_validation" IN ('valid', 'invalid'))`,
)
@Check(
  "contract_events_verdict",
  `"verdict" IS NULL OR ("validation" = 'valid' AND "surface" = 'receipt' AND "verdict" ~ '^[a-z0-9][a-z0-9_-]{0,31}$')`,
)
@Check(
  "contract_events_findings",
  `"findings_count" IS NULL OR ("validation" = 'valid' AND "surface" IN ('receipt', 'evidence') AND "findings_count" BETWEEN 0 AND 99999)`,
)
@Check(
  "contract_events_execution",
  `"execution" IS NULL OR ("surface" = 'tool_result' AND "execution" IN ('succeeded', 'failed', 'not-called', 'unknown') AND ("execution" <> 'not-called' OR "capture" <> 'captured'))`,
)
@Check(
  "contract_events_delivered",
  `"delivered" IS NULL OR ("surface" = 'tool_result' AND (NOT "delivered" OR ("capture" = 'captured' AND "validation" = 'valid')))`,
)
@Check(
  "contract_events_payload",
  `jsonb_typeof("payload") = 'object' AND length("payload"::text) <= 8192 AND ("capture" = 'captured' OR "payload" = '{}')`,
)
@Check(
  "contract_events_redacted",
  `jsonb_typeof("redacted") = 'array' AND jsonb_array_length("redacted") <= 64 AND length("redacted"::text) <= 4096`,
)
@Check(
  "contract_events_issues",
  `jsonb_typeof("issues") = 'array' AND jsonb_array_length("issues") <= 20 AND length("issues"::text) <= 4096 AND "issue_count" BETWEEN jsonb_array_length("issues") AND 99999 AND ("validation" IS DISTINCT FROM 'valid' OR "issue_count" = 0) AND ("validation" IS DISTINCT FROM 'invalid' OR "issue_count" > 0)`,
)
export class ContractEvent {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Text() authority!: "reported" | "authoritative";
  @Text() producerClass!: string;
  @Text() surface!: string;
  @Text() contractName!: string;
  @Text() contractDigest!: string;
  @OptionalText() projectionDigest!: string | null;

  // Reported: the token's person, the span's ids, where it ran.
  @OptionalUuid() userId!: string | null;
  @OptionalText() traceId!: string | null;
  @OptionalText() spanId!: string | null;
  @OptionalText() machine!: string | null;
  @OptionalUuid() projectId!: string | null;
  @OptionalText() project!: string | null;
  @OptionalText() host!: string | null;
  /** The run's hashed key, as local runs report it. */
  @OptionalText() run!: string | null;

  // Authoritative: the installation's credential and its own key.
  @OptionalUuid() installationId!: string | null;
  @OptionalText() idempotencyKey!: string | null;
  /** The Cloud run, kept after the run itself expires. */
  @OptionalUuid() runId!: string | null;
  /** The exact action this event was checked against. */
  @OptionalText() actionDigest!: string | null;

  // Runtime-owned envelope.
  /** The dispatched agent, as the runtime saw it; never a receipt field. */
  @OptionalText() agent!: string | null;
  @OptionalText() step!: string | null;
  @OptionalText() subjectRevision!: string | null;
  @OptionalText() subjectSource!: string | null;

  // States.
  @Text() capture!: "captured" | "missing" | "unsupported";
  @OptionalText() validation!: "valid" | "invalid" | null;
  @OptionalText() validatedBy!: "producer" | "server" | null;
  @OptionalText() projectionValidation!: "valid" | "invalid" | null;
  @OptionalText() verdict!: string | null;
  /** A valid receipt's or evidence's findings count, derived by the runtime. */
  @Int({ nullable: true }) findingsCount!: number | null;
  @OptionalText() execution!: string | null;
  /** A tool result handed on downstream; only a valid one is. */
  @Column({ type: "boolean", nullable: true }) delivered!: boolean | null;

  /** Projected values only, never a withheld one. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  payload!: JsonObject;
  /** Paths the projection withheld from this event. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  redacted!: string[];
  /** Where and why, never the rejected value. */
  @Column({ type: "jsonb", default: () => "'[]'" })
  issues!: SafeValidationIssue[];
  @Int({ default: 0 }) issueCount!: number;

  // Externally verified: the verifier, never an installation.
  @OptionalUuid() verifierId!: string | null;
  /** The evidence binding's name (`ci-tests`). */
  @OptionalText() evidence!: string | null;
  /**
   * The full valid value without classified paths, for the gate evaluator
   * only: no read API, view or export selects it, and the read role can't.
   */
  @Column({ type: "jsonb", nullable: true })
  authorizedValue!: JsonObject | null;
  /** The token's non-secret claims: run, attempt, workflow, ref, actor. */
  @Column({ type: "jsonb", nullable: true }) provenance!: JsonObject | null;
  /**
   * The submitted body's fingerprint, a verifier's or an installation's
   * brief, input or result: a retry matches it, another body doesn't.
   */
  @OptionalText() bodyDigest!: string | null;
  /** Arrival order: for one evidence and subject, the last received decides. */
  @Column({ type: "bigint" })
  @Generated("increment")
  seq!: string;

  /** When it happened, by the runtime's clock. */
  @Time() occurredAt!: Date;
  @Clock() receivedAt!: Date;

  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => WorkspaceMembership, member("user_id"), { nullable: true })
  reporter!: Relation<WorkspaceMembership> | null;
  @Fk(() => Installation, inWorkspace("installation_id"), { nullable: true })
  installation!: Relation<Installation> | null;
  @Fk(() => EvidenceVerifier, inWorkspace("verifier_id"), { nullable: true })
  verifier!: Relation<EvidenceVerifier> | null;
}
