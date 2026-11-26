import "server-only";
import { startSharedInput } from "@/contracts/v1/runtime-budgets";
import { parseInput, type RuntimeContext } from "@/server/db/context";
import { runtimeCaller } from "@/server/modules/runtime/caller";
import { budgetRevision } from "@/server/modules/runtime/policy-revision";
import { decisionExists, lockHostCalls } from "./host-order";

export async function startSharedBudgets(
  context: RuntimeContext,
  raw: unknown,
) {
  const input = parseInput(startSharedInput, raw);
  const refused = { claim_id: null, expires_at: null, started_at: null };
  const caller = await runtimeCaller(context, input.agent);
  context = caller.context;
  const live = await budgetRevision(context, input);
  if (live?.source_digest !== input.policy_digest || caller.refusal)
    return refused;

  const { manager, workspaceId, installationId } = context;
  await manager.query("SET LOCAL lock_timeout = '250ms'");
  await lockHostCalls(context);
  if (await decisionExists(context, input.call_fingerprint)) return refused;
  const [lease]: { id: string }[] = await manager.query(
    `SELECT id FROM nodrail.budget_leases
     WHERE workspace_id = $1 AND installation_id = $2 AND call_key = $3
       AND policy_digest = $4 AND claim_id IS NULL
       AND (agent_id IS NULL OR agent_id = $5)`,
    [
      workspaceId,
      installationId,
      input.call_fingerprint,
      input.policy_digest,
      context.agentId,
    ],
  );
  if (!lease) return refused;

  // Admission locks these same windows. It cannot see an expired reservation
  // while a valid start is still committing.
  const windows: { unknown_after: Date; ends_at: Date | null }[] =
    await manager.query(
      `SELECT r.unknown_after, w.ends_at
     FROM nodrail.budget_reservations r JOIN nodrail.budget_windows w
       ON w.workspace_id = r.workspace_id AND w.id = r.window_id
     WHERE r.workspace_id = $1 AND r.lease_id = $2 AND r.state = 'reserved'
     ORDER BY w.budget_key COLLATE "C", w.window_key COLLATE "C"
     FOR UPDATE OF w`,
      [workspaceId, lease.id],
    );
  if (!windows.length) return refused;
  const deadline = new Date(
    Math.min(
      ...windows.map(({ unknown_after, ends_at }) =>
        Math.min(unknown_after.getTime(), ends_at?.getTime() ?? Infinity),
      ),
    ),
  );
  const [started]: { at: Date }[] = await manager.query(
    `WITH instant AS MATERIALIZED (SELECT clock_timestamp() AS at),
     started AS (
       UPDATE nodrail.budget_reservations SET started_at = instant.at
       FROM instant
       WHERE workspace_id = $1 AND lease_id = $2 AND $3 > instant.at
         AND state = 'reserved' AND started_at IS NULL
       RETURNING started_at AS at
     )
     SELECT at FROM started LIMIT 1`,
    [workspaceId, lease.id, deadline],
  );
  if (!started) return refused;
  await manager.query(
    "UPDATE nodrail.budget_leases SET claim_id = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, lease.id, input.claim_id],
  );
  return {
    claim_id: input.claim_id,
    expires_at: deadline.toISOString(),
    started_at: started.at.toISOString(),
  };
}
