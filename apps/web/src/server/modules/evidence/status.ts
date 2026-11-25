import "server-only";
import { z } from "zod";
import type { EntityManager } from "typeorm";
import {
  evidenceStatusQuery,
  type EvidenceStatusDto,
  type EvidenceStatusQuery,
} from "@/contracts/v1/evidence";
import { compiledCondition } from "@/contracts/v1/shapes-engine";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import type { RuntimeContext } from "@/server/db/runtime-context";
import { evidenceShortfall } from "@/server/modules/runs/requirements";

/**
 * `GET /api/v1/evidence/status`: whether `externally-verified`
 * evidence meets one requirement of a published workspace revision, for a
 * local gate. The requirement is the one that revision pinned, found by
 * gate and index; a caller can name nothing else, so the answer can't be
 * used to probe values the projection withholds. An unpublished revision
 * or an unknown requirement is `NOT_FOUND`, which the hook reads as unmet.
 */

const pinnedRow = z.object({
  environment_id: z.string(),
  evidence: z.string(),
  authority: z.enum([
    "agent-reported",
    "runtime-observed",
    "externally-verified",
  ]),
  where: z.array(compiledCondition),
  contract_digest: z.string(),
  verifiers: z.array(z.string()),
});

/**
 * The status for the person's token (`read`). It runs as the application
 * role, not the read role: the evaluator reads the authorized value, which
 * the read role can't select, and nothing of it is returned.
 */
export async function evidenceStatus(
  context: WorkspaceContext,
  rawQuery: unknown,
): Promise<EvidenceStatusDto> {
  requireCapability(context, "workspace:read");
  const query = parseInput(evidenceStatusQuery, rawQuery);
  return pinnedStatus(context, query, {
    slug: query.environment ?? null,
  });
}

/**
 * The same status for a host's own credential (`evidence:read`): the
 * data plane asks with the credential it already holds, never a person's
 * token, and only about the environment that credential belongs to.
 */
export async function runtimeEvidenceStatus(
  context: RuntimeContext,
  rawQuery: unknown,
): Promise<EvidenceStatusDto> {
  const query = parseInput(evidenceStatusQuery, rawQuery);
  if (query.environment !== undefined) throw new AppError("INVALID_INPUT");
  return pinnedStatus(context, query, { id: context.environmentId });
}

async function pinnedStatus(
  scope: { manager: EntityManager; workspaceId: string },
  query: EvidenceStatusQuery,
  environment: { slug: string | null } | { id: string },
): Promise<EvidenceStatusDto> {
  const pins = parseRows(
    pinnedRow,
    await scope.manager.query(
      `SELECT r.environment_id, r.evidence, r.authority, r."where",
              b.contract_digest, b.verifiers
       FROM nodrail.evidence_requirements r
       JOIN nodrail.evidence_bindings b
         ON b.workspace_id = r.workspace_id
        AND b.environment_id = r.environment_id
        AND b.project_id = r.project_id
        AND b.workspace_revision = r.workspace_revision
        AND b.evidence = r.evidence
       WHERE r.workspace_id = $1 AND r.workspace_revision = $2
         AND r.gate = $3 AND r.requirement_index = $4
         AND ($5::text IS NULL OR r.environment_id = (
               SELECT e.id FROM nodrail.environments e
               WHERE e.workspace_id = r.workspace_id AND e.slug = $5))
         AND ($6::uuid IS NULL OR r.environment_id = $6)
       ORDER BY r.published_at`,
      [
        scope.workspaceId,
        query.workspace_revision,
        query.gate,
        query.requirement,
        "slug" in environment ? environment.slug : null,
        "id" in environment ? environment.id : null,
      ],
    ),
  );
  const [pin] = pins;
  if (!pin) throw new AppError("NOT_FOUND");
  // One revision digest is one content; it may be published to several
  // environments, and evidence submitted to any of them counts.
  return evidenceShortfall(
    scope,
    [...new Set(pins.map((p) => p.environment_id))],
    {
      evidence: pin.evidence,
      authority: pin.authority,
      where: pin.where,
      contractDigest: pin.contract_digest,
      verifiers: pin.verifiers,
    },
    query.subject,
  );
}
