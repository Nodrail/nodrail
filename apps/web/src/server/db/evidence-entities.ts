import { Check, Column, Entity, Index, Unique, type Relation } from "typeorm";
import type { CompiledCondition } from "@/contracts/v1/shapes-engine";
import {
  Clock,
  Fk,
  Id,
  Int,
  OptionalTime,
  OptionalUuid,
  Text,
  Time,
  Uuid,
  inWorkspace,
  member,
  schema,
} from "./columns";
import { WorkspaceMembership } from "./entities";
import { PublishedToEnvironment } from "./published-base";

/**
 * Evidence from outside the machine: who may produce
 * `externally-verified` evidence, each token's single use, and what one
 * published workspace revision declares about evidence. A verifier is
 * never edited: trust changes by creating a new one and revoking the old,
 * and a revocation takes back everything it ever produced.
 */

const name = (column: string) => `"${column}" ~ '^[a-z][a-z0-9-]{0,62}$'`;
const revision = `"workspace_revision" ~ '^[0-9a-f]{64}$'`;

/**
 * A GitHub Actions workflow trusted to produce evidence: the
 * repository by its numeric id and the exact reusable workflow at its
 * ref, so a branch author can't rewrite who produces trusted evidence.
 */
@Entity({ schema, name: "evidence_verifiers" })
@Unique(["workspaceId", "id"])
@Index("evidence_verifiers_active_name", ["workspaceId", "name"], {
  unique: true,
  where: `"revoked_at" IS NULL`,
})
@Check("evidence_verifiers_name", name("name"))
@Check("evidence_verifiers_kind", `"kind" = 'github-actions'`)
@Check(
  "evidence_verifiers_repository",
  `"repository_id" ~ '^[1-9][0-9]{0,19}$' AND length("repository") BETWEEN 3 AND 200`,
)
@Check(
  "evidence_verifiers_workflow",
  `length("job_workflow_ref") BETWEEN 3 AND 500 AND "job_workflow_ref" LIKE '%@%'`,
)
@Check(
  "evidence_verifiers_lists",
  `cardinality("environment_ids") BETWEEN 1 AND 20 AND cardinality("allowed_refs") <= 20`,
)
@Check(
  "evidence_verifiers_revoked",
  `("revoked_at" IS NULL) = ("revoked_by" IS NULL)`,
)
export class EvidenceVerifier {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  /** What an evidence binding's producers name. */
  @Text() name!: string;
  @Text({ default: "github-actions" }) kind!: "github-actions";
  /** The environments its evidence may be submitted to; never empty. */
  @Column({ type: "uuid", array: true }) environmentIds!: string[];
  /** GitHub's numeric id: a renamed or recreated repository is another. */
  @Text() repositoryId!: string;
  /** `owner/name`, for display and the run link only. */
  @Text() repository!: string;
  /** Exact: `owner/repo/.github/workflows/file.yml@refs/heads/main`. */
  @Text() jobWorkflowRef!: string;
  /** Globs over the run's `ref`; empty means any. */
  @Column({ type: "text", array: true, default: () => "'{}'" })
  allowedRefs!: string[];
  /** The admin who added it, and when. */
  @Uuid() createdBy!: string;
  @Fk(() => WorkspaceMembership, member("created_by"))
  creator!: Relation<WorkspaceMembership>;
  @Clock() createdAt!: Date;
  /** Revoked: none of its evidence counts, whenever it arrived. */
  @OptionalTime() revokedAt!: Date | null;
  @OptionalUuid() revokedBy!: string | null;
  @Fk(() => WorkspaceMembership, member("revoked_by"), { nullable: true })
  revoker!: Relation<WorkspaceMembership> | null;
}

/**
 * Each OIDC token is used once, bound to the body it carried: the same
 * body again is a retry, another body is a replay. Kept until a day after
 * the token expired, then retention removes it.
 */
@Entity({ schema, name: "evidence_token_uses" })
@Unique("evidence_token_uses_once", ["workspaceId", "verifierId", "jti"])
@Index("evidence_token_uses_by_expiry", ["expiresAt"])
@Check(
  "evidence_token_uses_values",
  `length("jti") BETWEEN 1 AND 200 AND "body_digest" ~ '^sha256:[0-9a-f]{64}$'`,
)
export class EvidenceTokenUse {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() verifierId!: string;
  @Text() jti!: string;
  @Text() bodyDigest!: string;
  /** The event it stored or matched; events outlive their token uses. */
  @Uuid() eventId!: string;
  @Time() expiresAt!: Date;
  @Clock() createdAt!: Date;
  @Fk(() => EvidenceVerifier, inWorkspace("verifier_id"))
  verifier!: Relation<EvidenceVerifier>;
}

/** The keys one published workspace revision of a project is found by. */
abstract class PinnedToRevision extends PublishedToEnvironment {
  @Id() id!: string;
  /** The lock's workspace digest, then where it was published. */
  @Text() workspaceRevision!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Uuid() projectId!: string;
  @Text() evidence!: string;
}

/** A pin's keys: one published revision of one project in one environment. */
const PINNED = [
  "workspaceId",
  "environmentId",
  "projectId",
  "workspaceRevision",
] as const;

/**
 * An evidence binding of a published workspace revision: its contract and
 * the verifiers its `externally-verified` producers name. Ingestion takes
 * evidence only from a verifier the intended revision lists.
 */
@Entity({ schema, name: "evidence_bindings" })
@Unique("evidence_bindings_target", [...PINNED, "evidence"])
@Check(
  "evidence_bindings_values",
  `${revision} AND ${name("evidence")} AND "contract_digest" ~ '^sha256:[0-9a-f]{64}$' AND cardinality("verifiers") <= 10 AND "subject" IN ('revision', 'none')`,
)
export class EvidenceBinding extends PinnedToRevision {
  @Text() contractDigest!: string;
  @Column({ type: "text", array: true }) verifiers!: string[];
  @Text() subject!: "revision" | "none";
}

/**
 * A gate requirement on evidence, as the published workspace revision
 * compiled it: the only conditions the status endpoint evaluates, so no
 * caller can ask about a field it doesn't report.
 */
@Entity({ schema, name: "evidence_requirements" })
@Unique("evidence_requirements_target", [...PINNED, "gate", "requirementIndex"])
@Check(
  "evidence_requirements_values",
  `${revision} AND ${name("evidence")} AND length("gate") BETWEEN 1 AND 200 AND "requirement_index" BETWEEN 0 AND 19 AND "authority" IN ('agent-reported', 'runtime-observed', 'externally-verified') AND jsonb_typeof("where") = 'array' AND jsonb_array_length("where") <= 20 AND length("where"::text) <= 8192`,
)
export class EvidenceRequirement extends PinnedToRevision {
  @Text() gate!: string;
  @Int() requirementIndex!: number;
  @Text() authority!: string;
  @Column({ type: "jsonb", default: () => "'[]'" })
  where!: CompiledCondition[];
}
