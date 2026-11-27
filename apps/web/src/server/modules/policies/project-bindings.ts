import "server-only";
import { contractDigest } from "@nodrail/policy-engine/contracts";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import { compilePolicies, evidencePins } from "@nodrail/policy-engine/yaml";
import type { Declarations, ProjectApply } from "@/contracts/v1/project-apply";
import { AppError, type WorkspaceContext } from "@/server/db/context";
import { pinContracts } from "@/server/modules/contracts/registry";
import { pinEvidence } from "@/server/modules/evidence/verifiers";
import { managedOf } from "@/contracts/v1/project-apply";
import { sourceColumns } from "./managed";

type Intended = ProjectApply["intended"];

export async function validateProjectBindings(
  context: WorkspaceContext,
  environment: { id: string; slug: string },
  {
    yaml,
    declarations,
    intended,
  }: { yaml: string; declarations: Declarations; intended: Intended },
) {
  const managed = managedOf(intended);
  if (
    managed.project_id !== declarations.project_id ||
    managed.policy_revision !==
      sourceColumns({ managed, source: yaml }).sourceDigest
  )
    throw new AppError(
      "INVALID_INPUT",
      "The declarations and policy must match the locked project revision.",
    );

  const compiled = compilePolicies([{ name: "effective.yaml", text: yaml }]);
  // Policy preview reports syntax and target failures with source lines.
  if (!compiled.ok) return;
  const evidence = evidencePins(compiled.document);
  if (fingerprint(evidence ?? null) !== fingerprint(intended.evidence ?? null))
    throw new AppError(
      "INVALID_INPUT",
      "The evidence bindings must match the locked policy.",
    );

  validateContracts(intended.contracts, evidence);
  await validateVerifiers(context, environment, evidence);
}

function validateContracts(
  contracts: Intended["contracts"],
  evidence: Intended["evidence"],
) {
  const bindings = new Map(
    contracts?.bindings.map((binding) => [
      binding.target,
      binding.contract_digest,
    ]),
  );
  if (
    bindings.size !== (contracts?.bindings.length ?? 0) ||
    contracts?.revisions.some(
      (entry) => contractDigest("shape", entry.shape) !== entry.digest,
    ) ||
    evidence?.bindings.some(
      ({ evidence, contract_digest }) =>
        bindings.get(`evidence:${evidence}`) !== contract_digest,
    )
  )
    throw new AppError(
      "INVALID_INPUT",
      "The contract bindings do not match the locked policy. Run nodrail policy lock again.",
    );
}

async function validateVerifiers(
  context: WorkspaceContext,
  environment: { id: string; slug: string },
  evidence: Intended["evidence"],
) {
  const verifiers = [
    ...new Set(evidence?.bindings.flatMap((binding) => binding.verifiers)),
  ];
  if (!verifiers.length) return;
  const active: { name: string }[] = await context.manager.query(
    `SELECT name FROM nodrail.evidence_verifiers
     WHERE workspace_id = $1 AND name = ANY($2::text[])
       AND revoked_at IS NULL AND $3 = ANY(environment_ids)`,
    [context.workspaceId, verifiers, environment.id],
  );
  const activeNames = new Set(active.map(({ name }) => name));
  const missing = verifiers.filter((name) => !activeNames.has(name));
  if (missing.length)
    throw new AppError(
      "INVALID_INPUT",
      `Ask a workspace admin to configure active evidence verifiers for ${environment.slug}: ${missing.join(", ")}.`,
    );
}

export async function pinProjectBindings(
  context: WorkspaceContext,
  environmentId: string,
  intended: Intended,
) {
  const where = {
    environmentId,
    projectId: intended.project_id,
    workspaceRevision: intended.revision,
  };
  if (intended.contracts)
    await pinContracts(context, where, intended.contracts);
  if (intended.evidence) await pinEvidence(context, where, intended.evidence);
}
