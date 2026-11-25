import "server-only";
import { createHash } from "node:crypto";
import type { ManagedSource } from "@/contracts/v1/public-api";
import { requireCapability, type WorkspaceContext } from "@/server/db/context";
import type { RuntimeContext } from "@/server/db/runtime-context";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * Connected mode: which repository project and lock a policy
 * version was published from, and what is live, as `nodrail plan` reads it.
 */

/** The project and lock the live version came from, or null. */
async function liveSource(context: WorkspaceContext, environmentId: string) {
  const [row]: {
    managed_project_id: string | null;
    managed_revision: string | null;
    managed_policy_revision: string | null;
    source_digest: string | null;
  }[] = await context.manager.query(
    `SELECT v.managed_project_id, v.managed_revision, v.managed_policy_revision, v.source_digest
     FROM nodrail.active_policies a
     JOIN nodrail.policy_versions v
       ON v.workspace_id = a.workspace_id AND v.environment_id = a.environment_id
      AND v.id = a.policy_version_id
     WHERE a.workspace_id = $1 AND a.environment_id = $2`,
    [context.workspaceId, environmentId],
  );
  return {
    managed:
      row?.managed_project_id && row.managed_revision
        ? {
            project_id: row.managed_project_id,
            revision: row.managed_revision,
            policy_revision: row.managed_policy_revision,
          }
        : null,
    source_digest: row?.source_digest ?? null,
  };
}

const sameSource = (a: ManagedSource | null, b: ManagedSource) =>
  a !== null &&
  a.project_id === b.project_id &&
  a.revision === b.revision &&
  a.policy_revision === b.policy_revision;

/**
 * Whether publishing would make no new version. The same rules from a
 * repository that doesn't manage the live version yet still do: who manages
 * it is part of what's live.
 */
export async function nothingToPublish(
  context: WorkspaceContext,
  environmentId: string,
  counts: { added: number; changed: number; removed: number },
  origin: VersionOrigin,
) {
  if (counts.added || counts.changed || counts.removed) return false;
  if (!origin.managed) return true;
  const live = await liveSource(context, environmentId);
  return (
    sameSource(live.managed, origin.managed) &&
    live.source_digest === sourceColumns(origin).sourceDigest
  );
}

/** What a publish must match: the preview it follows, and where it comes from. */
export type Previewed = {
  revision: number;
  fileDigest: string;
  /** The repository project and lock it comes from, when apply sends it. */
  managed?: ManagedSource | null;
};

/** Where a version comes from: the project and lock, and the file. */
export type VersionOrigin = {
  managed: ManagedSource | null;
  /** The file it was published from, kept for hosts to fetch. */
  source: string | null;
};

/** Where a publish comes from: what apply named, and the file sent. */
export const originOf = (
  expected: Previewed,
  text: unknown,
): VersionOrigin => ({
  managed: expected.managed ?? null,
  source: typeof text === "string" ? text : null,
});

/**
 * A version's columns for where it came from: the repository project and
 * lock apply named, and the file it was published from with its SHA-256,
 * which is the digest a lock records for that file.
 */
export const sourceColumns = (origin: VersionOrigin | undefined) => ({
  managedProjectId: origin?.managed?.project_id ?? null,
  managedRevision: origin?.managed?.revision ?? null,
  managedPolicyRevision: origin?.managed?.policy_revision ?? null,
  sourceText: origin?.source ?? null,
  sourceDigest:
    origin?.source == null
      ? null
      : createHash("sha256").update(origin.source).digest("hex"),
});

/** What is live in an environment and where it came from. */
export async function readLiveVersion(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  requireCapability(context, "workspace:read");
  const { id: environmentId } = await findEnvironment(context, environmentSlug);
  const [row]: {
    revision: number;
    published_at: Date;
    published_by: string | null;
  }[] = await context.manager.query(
    `SELECT v.revision, v.published_at, u.display_name AS published_by
     FROM nodrail.active_policies a
     JOIN nodrail.policy_versions v
       ON v.workspace_id = a.workspace_id AND v.environment_id = a.environment_id
      AND v.id = a.policy_version_id
     LEFT JOIN nodrail.users u ON u.id = v.published_by
     WHERE a.workspace_id = $1 AND a.environment_id = $2`,
    [context.workspaceId, environmentId],
  );
  return {
    environment: environmentSlug,
    policy_revision: row?.revision ?? 0,
    published_at: row?.published_at.toISOString() ?? null,
    published_by: row?.published_by ?? null,
    ...(await liveSource(context, environmentId)),
  };
}

/**
 * What a host's data plane runs (`GET /runtime/policy`): the live
 * version of the credential's environment, where it came from, and the
 * file it was published from with its digest. A version made on screen has
 * no file, so `source` is null.
 */
export async function readRuntimePolicy(context: RuntimeContext) {
  const [row]: {
    revision: number;
    published_at: Date;
    managed_project_id: string | null;
    managed_revision: string | null;
    managed_policy_revision: string | null;
    source_text: string | null;
    source_digest: string | null;
  }[] = await context.manager.query(
    `SELECT v.revision, v.published_at, v.managed_project_id,
            v.managed_revision, v.managed_policy_revision,
            v.source_text, v.source_digest
     FROM nodrail.active_policies a
     JOIN nodrail.policy_versions v
       ON v.workspace_id = a.workspace_id AND v.environment_id = a.environment_id
      AND v.id = a.policy_version_id
     WHERE a.workspace_id = $1 AND a.environment_id = $2`,
    [context.workspaceId, context.environmentId],
  );
  return {
    policy_revision: row?.revision ?? 0,
    published_at: row?.published_at.toISOString() ?? null,
    managed:
      row?.managed_project_id && row.managed_revision
        ? {
            project_id: row.managed_project_id,
            revision: row.managed_revision,
            policy_revision: row.managed_policy_revision,
          }
        : null,
    source:
      row?.source_text != null && row.source_digest
        ? { digest: row.source_digest, text: row.source_text }
        : null,
  };
}
