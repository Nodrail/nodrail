import "server-only";
import { z } from "zod";
import {
  createVerifierInput,
  type EvidenceClosureInput,
  type VerifierDto,
} from "@/contracts/v1/evidence";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { recordAudit } from "@/server/modules/audit";

/**
 * Verifiers: GitHub Actions workflows an admin trusts to
 * produce `externally-verified` evidence. Never edited: a change of trust is
 * a new verifier and a revoked old one, and a revocation takes back all of
 * its evidence, past and future. Also what a published workspace
 * revision pins about evidence: which verifiers each binding names, and its
 * gates' compiled requirements on evidence.
 */

/**
 * The `aud` a workflow requests its token for: this deployment's origin and
 * the workspace. A token for one workspace is never good for another.
 */
export function evidenceAudience(workspaceId: string) {
  const origin = process.env.APP_ORIGIN?.replace(/\/+$/, "");
  if (!origin) throw new Error("APP_ORIGIN missing");
  return `${origin}/w/${workspaceId}`;
}

/**
 * Only an admin changes who is trusted. A token carries the person's role
 * narrowed to its scopes, so it needs `rules:write` as well.
 */
function requireVerifierAdmin(context: WorkspaceContext) {
  requireCapability(context, "policies:write");
  if (context.role !== "admin") throw new AppError("FORBIDDEN");
}

const verifierRow = z.object({
  id: z.string(),
  name: z.string(),
  repository_id: z.string(),
  repository: z.string(),
  job_workflow_ref: z.string(),
  allowed_refs: z.array(z.string()),
  environments: z.array(z.string()),
  created_by: z.string(),
  created_at: z.date(),
  revoked_at: z.date().nullable(),
});

const toDto = (
  workspaceId: string,
  row: z.infer<typeof verifierRow>,
): VerifierDto => ({
  id: row.id,
  name: row.name,
  kind: "github-actions",
  repositoryId: row.repository_id,
  repository: row.repository,
  jobWorkflowRef: row.job_workflow_ref,
  allowedRefs: row.allowed_refs,
  environments: row.environments,
  audience: evidenceAudience(workspaceId),
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
  revokedAt: row.revoked_at?.toISOString() ?? null,
});

const selectVerifiers = `
  SELECT v.id, v.name, v.repository_id, v.repository, v.job_workflow_ref,
         v.allowed_refs, v.created_at, v.revoked_at, u.display_name AS created_by,
         ARRAY(SELECT e.slug FROM nodrail.environments e
               WHERE e.workspace_id = v.workspace_id
                 AND e.id = ANY(v.environment_ids)
               ORDER BY e.slug) AS environments
  FROM nodrail.evidence_verifiers v
  JOIN nodrail.users u ON u.id = v.created_by
  WHERE v.workspace_id = $1`;

/** Every verifier, revoked ones too: their evidence still names them. */
export async function listVerifiers(
  context: WorkspaceContext,
): Promise<VerifierDto[]> {
  requireCapability(context, "workspace:read");
  const rows = parseRows(
    verifierRow,
    await context.manager.query(
      `${selectVerifiers} ORDER BY v.revoked_at IS NOT NULL, v.name, v.created_at DESC
       LIMIT 200`,
      [context.workspaceId],
    ),
  );
  return rows.map((row) => toDto(context.workspaceId, row));
}

async function oneVerifier(context: WorkspaceContext, id: string) {
  const [row] = parseRows(
    verifierRow,
    await context.manager.query(`${selectVerifiers} AND v.id = $2`, [
      context.workspaceId,
      id,
    ]),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return toDto(context.workspaceId, row);
}

/** A new verifier; a name already active is `ALREADY_EXISTS`. */
export async function createVerifier(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<VerifierDto> {
  requireVerifierAdmin(context);
  const input = parseInput(createVerifierInput, rawInput);
  const environments: { id: string }[] = await context.manager.query(
    `SELECT id FROM nodrail.environments
     WHERE workspace_id = $1 AND slug = ANY($2)`,
    [context.workspaceId, input.environments],
  );
  if (environments.length !== new Set(input.environments).size)
    throw new AppError("INVALID_INPUT");
  const [row]: { id: string }[] = await context.manager.query(
    `INSERT INTO nodrail.evidence_verifiers
       (workspace_id, name, environment_ids, repository_id, repository,
        job_workflow_ref, allowed_refs, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      context.workspaceId,
      input.name,
      environments.map((e) => e.id),
      input.repository_id,
      input.repository,
      input.job_workflow_ref,
      input.allowed_refs,
      context.principal.userId,
    ],
  );
  await recordAudit(context, {
    eventType: "evidence.verifier_created",
    decisionCode: "verifier_created",
    payload: {
      subject: input.name,
      detail: `${input.repository} · ${input.job_workflow_ref}`.slice(0, 500),
    },
  });
  return oneVerifier(context, row!.id);
}

/**
 * Revokes a verifier: its evidence, already stored or still to come, no
 * longer satisfies anything. Revoking twice changes nothing.
 */
export async function revokeVerifier(
  context: WorkspaceContext,
  id: string,
): Promise<VerifierDto> {
  requireVerifierAdmin(context);
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const [row]: { name: string }[] = await context.manager.query(
    `WITH revoked AS (
       UPDATE nodrail.evidence_verifiers
       SET revoked_at = clock_timestamp(), revoked_by = $3
       WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
       RETURNING name)
     SELECT name FROM revoked`,
    [context.workspaceId, id, context.principal.userId],
  );
  if (row)
    await recordAudit(context, {
      eventType: "evidence.verifier_revoked",
      decisionCode: "verifier_revoked",
      payload: { subject: row.name },
    });
  return oneVerifier(context, id);
}

/**
 * Pins what a published workspace revision says about evidence, inside the
 * publish transaction and after its contracts: each binding must be one of
 * the revision's `evidence:<name>` bindings with the same contract.
 */
export async function pinEvidence(
  context: WorkspaceContext,
  where: {
    environmentId: string;
    projectId: string;
    workspaceRevision: string;
  },
  closure: EvidenceClosureInput,
) {
  requireCapability(context, "policies:write");
  const keys = [
    context.workspaceId,
    where.environmentId,
    where.projectId,
    where.workspaceRevision,
  ];
  const bound: { target: string; contract_digest: string }[] =
    await context.manager.query(
      `SELECT target, contract_digest FROM nodrail.contract_bindings
       WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3
         AND workspace_revision = $4 AND surface = 'evidence'`,
      keys,
    );
  const contracts = new Map(bound.map((b) => [b.target, b.contract_digest]));
  for (const binding of closure.bindings) {
    if (
      contracts.get(`evidence:${binding.evidence}`) !== binding.contract_digest
    )
      throw new AppError("INVALID_INPUT");
    await context.manager.query(
      `INSERT INTO nodrail.evidence_bindings
         (workspace_id, environment_id, project_id, workspace_revision,
          evidence, contract_digest, verifiers, subject, published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT ON CONSTRAINT evidence_bindings_target DO NOTHING`,
      [
        ...keys,
        binding.evidence,
        binding.contract_digest,
        binding.verifiers,
        binding.subject,
        context.principal.userId,
      ],
    );
  }
  for (const requirement of closure.requirements)
    await context.manager.query(
      `INSERT INTO nodrail.evidence_requirements
         (workspace_id, environment_id, project_id, workspace_revision,
          gate, requirement_index, evidence, authority, "where", published_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT ON CONSTRAINT evidence_requirements_target DO NOTHING`,
      [
        ...keys,
        requirement.gate,
        requirement.index,
        requirement.evidence,
        requirement.authority,
        JSON.stringify(requirement.where),
        context.principal.userId,
      ],
    );
}
