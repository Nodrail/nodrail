import "server-only";
import { fingerprint } from "@nodrail/sdk/protocol";
import type { ProjectApply } from "@/contracts/v1/project-apply";
import { AppError, type WorkspaceContext } from "@/server/db/context";

type Intended = ProjectApply["intended"];
type Contract = NonNullable<Intended["contracts"]>["bindings"][number];
type Evidence = NonNullable<Intended["evidence"]>;
type Pins = {
  contracts: Contract[] | null;
  evidence: Evidence["bindings"] | null;
  requirements: Evidence["requirements"] | null;
};

/** Detect missing bindings for an older apply and refuse conflicting immutable pins. */
export async function projectPinsCurrent(
  context: WorkspaceContext,
  environmentId: string,
  intended: Intended,
) {
  if (!intended.contracts && !intended.evidence) return true;

  const [stored]: Pins[] = await context.manager.query(
    `SELECT
      (SELECT jsonb_agg(to_jsonb(pin)) FROM (
        SELECT surface, target, contract_digest FROM nodrail.contract_bindings
        WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3 AND workspace_revision = $4
      ) pin) AS contracts,
      (SELECT jsonb_agg(to_jsonb(pin)) FROM (
        SELECT evidence, contract_digest, verifiers, subject FROM nodrail.evidence_bindings
        WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3 AND workspace_revision = $4
      ) pin) AS evidence,
      (SELECT jsonb_agg(to_jsonb(pin)) FROM (
        SELECT gate, requirement_index AS index, evidence, authority, 'revision' AS subject, "where"
        FROM nodrail.evidence_requirements
        WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3 AND workspace_revision = $4
      ) pin) AS requirements`,
    [
      context.workspaceId,
      environmentId,
      intended.project_id,
      intended.revision,
    ],
  );
  const contracts = match(
    stored?.contracts,
    intended.contracts?.bindings,
    (binding) => binding.target,
  );
  const evidence = match(
    stored?.evidence,
    intended.evidence?.bindings,
    (binding) => binding.evidence,
  );
  const requirements = match(
    stored?.requirements,
    intended.evidence?.requirements,
    (pin) => `${pin.gate}#${pin.index}`,
  );
  return contracts && evidence && requirements;
}

function match<T>(
  stored: T[] | null | undefined,
  wanted: T[] | undefined,
  key: (row: T) => string,
) {
  const expected = new Map(wanted?.map((row) => [key(row), fingerprint(row)]));
  for (const row of stored ?? [])
    if (expected.get(key(row)) !== fingerprint(row))
      throw new AppError(
        "INVALID_INPUT",
        "Existing bindings for this workspace revision disagree with the lock. Review the bindings and publish a new lock revision.",
      );
  return (stored?.length ?? 0) === expected.size;
}
