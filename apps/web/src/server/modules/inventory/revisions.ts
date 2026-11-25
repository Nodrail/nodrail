import "server-only";
import { z } from "zod";
import {
  publishRevisionInput,
  type IntendedRevisionDto,
} from "@/contracts/v1/inventory";
import {
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";
import { pinContracts } from "@/server/modules/contracts/registry";
import { pinEvidence } from "@/server/modules/evidence/verifiers";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * The revision a team intends an environment to run, per project (W4.3).
 * Git carries the files; this records which locked revision is the one,
 * so the inventory can say which machines are behind. Publishing takes
 * the same capability as publishing rules.
 */

const revisionRow = z.object({
  project_id: z.string(),
  project: z.string(),
  revision: z.string(),
  policy_revision: z.string().nullable(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
  display_name: z.string(),
  published_at: z.date(),
});

const toDto = (row: z.infer<typeof revisionRow>): IntendedRevisionDto => ({
  projectId: row.project_id,
  project: row.project,
  revision: row.revision,
  policyRevision: row.policy_revision,
  files: row.files,
  publishedBy: row.display_name,
  publishedAt: row.published_at.toISOString(),
});

const selectRevisions = `
  SELECT r.project_id, r.project, r.revision, r.policy_revision, r.files, u.display_name,
         r.published_at
  FROM nodrail.intended_revisions r
  JOIN nodrail.users u ON u.id = r.published_by
  WHERE r.workspace_id = $1 AND r.environment_id = $2`;

/** Each project's intended revision in the environment, by project id. */
export async function intendedRevisions(
  context: WorkspaceContext,
  environmentId: string,
  projectId?: string,
) {
  const rows = parseRows(
    revisionRow,
    await context.manager.query(
      `${selectRevisions} AND ($3::uuid IS NULL OR r.project_id = $3)
       ORDER BY r.project LIMIT 500`,
      [context.workspaceId, environmentId, projectId ?? null],
    ),
  );
  return new Map(rows.map((row) => [row.project_id, toDto(row)]));
}

export async function getIntendedRevision(
  context: WorkspaceContext,
  environmentSlug: string,
  projectId: string,
): Promise<IntendedRevisionDto | null> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  return (
    (await intendedRevisions(context, environment.id, projectId)).get(
      projectId,
    ) ?? null
  );
}

/**
 * Makes the lock's revision the one this environment intends for the
 * project, replacing the last, and records who did in Activity.
 */
export async function publishIntendedRevision(
  context: WorkspaceContext,
  environmentSlug: string,
  rawInput: unknown,
): Promise<{ revision: IntendedRevisionDto; previous: string | null }> {
  requireCapability(context, "policies:write");
  const input = parseInput(publishRevisionInput, rawInput);
  const environment = await findEnvironment(context, environmentSlug);
  const before = await intendedRevisions(
    context,
    environment.id,
    input.project_id,
  );
  await context.manager.query(
    `INSERT INTO nodrail.intended_revisions
       (workspace_id, environment_id, project, revision, policy_revision,
        files, published_by, project_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT ON CONSTRAINT intended_revisions_project DO UPDATE SET
       revision = excluded.revision, project = excluded.project,
       policy_revision = excluded.policy_revision, files = excluded.files,
       published_by = excluded.published_by, published_at = clock_timestamp()`,
    [
      context.workspaceId,
      environment.id,
      input.project,
      input.revision,
      input.policy_revision,
      JSON.stringify(input.files),
      context.principal.userId,
      input.project_id,
    ],
  );
  const pinned = {
    environmentId: environment.id,
    projectId: input.project_id,
    workspaceRevision: input.revision,
  };
  if (input.contracts) await pinContracts(context, pinned, input.contracts);
  if (input.evidence) await pinEvidence(context, pinned, input.evidence);
  const previous = before.get(input.project_id)?.revision ?? null;
  await recordAudit(context, {
    eventType: "workspace.revision_published",
    decisionCode: "workspace_revision_published",
    environmentId: environment.id,
    payload: {
      subject: input.project,
      detail: `Revision ${input.revision.slice(0, 12)}${previous ? `, was ${previous.slice(0, 12)}` : ""}`,
    },
  });
  const after = await intendedRevisions(
    context,
    environment.id,
    input.project_id,
  );
  return { revision: after.get(input.project_id)!, previous };
}
