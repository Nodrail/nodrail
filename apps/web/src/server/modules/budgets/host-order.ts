import "server-only";
import type { RuntimeContext } from "@/server/db/context";

/** One lock per installation also orders decision batches with many call keys. */
export async function lockHostCalls(context: RuntimeContext) {
  await context.manager.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('host-budget:' || $1::text, 0))",
    [context.installationId],
  );
}

export async function decisionExists(context: RuntimeContext, callKey: string) {
  const rows: unknown[] = await context.manager.query(
    `SELECT 1 FROM nodrail.action_requests
     WHERE workspace_id = $1 AND installation_id = $2 AND idempotency_key = $3`,
    [context.workspaceId, context.installationId, callKey],
  );
  return rows.length > 0;
}
