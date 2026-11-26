import { Check, Column, Entity, Index, Unique } from "typeorm";
import { Id, Int, OptionalText, Text, Time, Uuid, schema } from "./columns";
import { PublishedToEnvironment } from "./published-base";
import { ReportedByPerson } from "./reported-base";

/**
 * What one of a person's machines last reported about one project on one
 * host, as `nodrail observe` sends it (W4): counts, revisions and whether
 * the policy runs; names only when the project opted in. Never a path or a
 * file's contents. Only the latest is kept: an older one never replaces it.
 */
@Entity({ schema, name: "inventory_reports" })
@Unique("inventory_reports_latest", [
  "workspaceId",
  "environmentId",
  "userId",
  "machine",
  "projectKey",
  "host",
])
@Index("inventory_reports_by_environment", [
  "workspaceId",
  "environmentId",
  "observedAt",
])
@Check("inventory_reports_machine", `"machine" ~ '^[0-9a-f]{32}$'`)
@Check("inventory_reports_project", `length("project") BETWEEN 1 AND 200`)
@Check("inventory_reports_host", `"host" ~ '^[a-z][a-z0-9-]{0,39}$'`)
@Check("inventory_reports_agent", `length("agent") <= 200`)
@Check(
  "inventory_reports_activation",
  `"activation" IN ('verified', 'configured', 'inactive', 'unknown')`,
)
@Check(
  "inventory_reports_revisions",
  `("applied_revision" IS NULL OR "applied_revision" ~ '^[0-9a-f]{64}$') AND ("locked_revision" IS NULL OR "locked_revision" ~ '^[0-9a-f]{64}$')`,
)
@Check("inventory_reports_drift", `"drift" BETWEEN 0 AND 100000`)
@Check(
  "inventory_reports_sizes",
  `length("unmanaged"::text) <= 2000 AND ("names" IS NULL OR length("names"::text) <= 10000)`,
)
@Check(
  "inventory_reports_project_key",
  `"project_key" = coalesce("project_id"::text, 'unbound:' || "project")`,
)
export class InventoryReport extends ReportedByPerson {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Uuid() userId!: string;
  /** The machine's random id, never its name. */
  @Text() machine!: string;
  /** The project's stable id; null when reported before contract v2. */
  @Column({ type: "uuid", nullable: true }) projectId!: string | null;
  /** The id, or `unbound:<name>`: never two projects merged by name. */
  @Text() projectKey!: string;
  @Text() project!: string;
  @Text() host!: string;
  @OptionalText() agent!: string | null;
  @Text() activation!: string;
  @Column({ type: "boolean" }) inStep!: boolean;
  @Int() drift!: number;
  @OptionalText() appliedRevision!: string | null;
  @OptionalText() lockedRevision!: string | null;
  /** Count by kind, such as `{ "skill": 2 }`. */
  @Column({ type: "jsonb" }) unmanaged!: Record<string, number>;
  /** Only when the project sends names: `{ drift: [...], unmanaged: [...] }`. */
  @Column({ type: "jsonb", nullable: true })
  names!: { drift: string[]; unmanaged: string[] } | null;
  @Time() observedAt!: Date;
  @Column({ type: "timestamptz", nullable: true }) lastSeenAt!: Date | null;
}

/**
 * The workspace revision a team intends an environment to run for one
 * project, as `nodrail workspace publish` sent it from the project's lock:
 * digests and project-relative paths, never a file's contents. Git still
 * carries the files; this says which revision is the one.
 */
@Entity({ schema, name: "intended_revisions" })
@Unique("intended_revisions_project", [
  "workspaceId",
  "environmentId",
  "projectId",
])
@Check("intended_revisions_project_name", `length("project") BETWEEN 1 AND 200`)
@Check("intended_revisions_revision", `"revision" ~ '^[0-9a-f]{64}$'`)
@Check(
  "intended_revisions_policy",
  `"policy_revision" IS NULL OR "policy_revision" ~ '^[0-9a-f]{64}$'`,
)
@Check("intended_revisions_files", `length("files"::text) <= 300000`)
export class IntendedRevision extends PublishedToEnvironment {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  /** The project's stable id; a revision is never published by name. */
  @Uuid() projectId!: string;
  /** Its name when published, for display. */
  @Text() project!: string;
  @OptionalText() entryAgent!: string | null;
  @Text() revision!: string;
  @OptionalText() policyRevision!: string | null;
  /** The lock's files: `[{ path, sha256 }]`. */
  @Column({ type: "jsonb" }) files!: { path: string; sha256: string }[];
}
