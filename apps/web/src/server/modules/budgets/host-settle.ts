import "server-only";
import { settleSharedInput } from "@/contracts/v1/runtime-budgets";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { touch } from "@/server/modules/runtime/touch";
import { readingFor, settle } from "./settle";

/** A lease may be settled before the decision batch arrives. */
export async function settleSharedBudgets(
  context: RuntimeContext,
  raw: unknown,
) {
  const input = parseInput(settleSharedInput, raw);
  const { manager, workspaceId, installationId } = context;
  const [row]: {
    id: string;
    policy_digest: string;
    claim_id: string | null;
  }[] = await manager.query(
    `SELECT id, policy_digest, claim_id FROM nodrail.budget_leases
     WHERE workspace_id = $1 AND installation_id = $2 AND call_key = $3`,
    [workspaceId, installationId, input.call_fingerprint],
  );
  if (!row) throw new AppError("NOT_FOUND");
  // A publication can advance after a valid start. Match the digest that
  // authorized the work so the report still accounts for that work.
  if (!row.claim_id || row.policy_digest !== input.policy_digest)
    throw new AppError("DECISION_CONFLICT");
  const key = { leaseId: row.id };
  const reading = await readingFor(context, key, input.measured ?? [], {
    tokens: input.tokens,
    filter: true,
  });
  await settle(context, key, input.outcome, reading);
  await touch(context);
  return { recorded: true };
}

/** Associate the same installation's reservations with its reported decision. */
export async function attachSharedBudgets(
  { manager, workspaceId, installationId }: RuntimeContext,
  actionId: string,
  callKey: string,
  policyDigest: string | null,
) {
  await manager.query(
    `UPDATE nodrail.budget_reservations r SET action_request_id = $3
     FROM nodrail.budget_leases l
     WHERE l.workspace_id = $1 AND l.installation_id = $2 AND l.call_key = $4
       AND l.policy_digest = $5 AND l.claim_id IS NOT NULL
       AND r.workspace_id = l.workspace_id AND r.lease_id = l.id
       AND r.action_request_id IS NULL`,
    [workspaceId, installationId, actionId, callKey, policyDigest],
  );
}
