import "server-only";
import type { RuntimeContext } from "@/server/db/context";

/**
 * Every runtime call is a sign of life from its installation. Never waited
 * for: if another call holds the row, it is marking the same thing, so
 * concurrent calls of one installation don't queue behind each other here.
 */
export async function touch(context: RuntimeContext, adapterVersion?: string) {
  const { manager, workspaceId, installationId, credentialId } = context;
  await manager.query(
    `UPDATE nodrail.installations
     SET last_seen_at = clock_timestamp(),
         adapter_version = COALESCE($3, adapter_version)
     WHERE id = (SELECT id FROM nodrail.installations
                 WHERE workspace_id = $1 AND id = $2
                 FOR NO KEY UPDATE SKIP LOCKED)`,
    [workspaceId, installationId, adapterVersion ?? null],
  );
  await manager.query(
    `UPDATE nodrail.installation_credentials SET last_used_at = clock_timestamp()
     WHERE id = (SELECT id FROM nodrail.installation_credentials
                 WHERE workspace_id = $1 AND id = $2
                 FOR NO KEY UPDATE SKIP LOCKED)`,
    [workspaceId, credentialId],
  );
}
