import "server-only";
import type { EntityManager } from "typeorm";
import { RUNTIME_CALLS_PER_MINUTE } from "@/contracts/v1/runtime";
import { matchesDigest } from "@/server/security/secrets";
import { AppError, transaction, workspaceForPrefix } from "./context";

/**
 * The agent side: an installation credential (`ndr_…`) decides workspace,
 * installation, agent and environment. People's API tokens are in
 * token-context.ts; neither accepts the other's.
 */
export type RuntimeScope =
  | "actions:submit"
  | "actions:read-own"
  | "permits:request"
  | "reports:write-own"
  | "heartbeat:write"
  // The data plane: the hook decides on the host and asks the
  // control plane only for these.
  | "policy:read"
  | "decisions:write"
  | "budgets:reserve"
  | "evidence:read";

export type RuntimeContext = {
  manager: EntityManager;
  workspaceId: string;
  credentialId: string;
  installationId: string;
  agentId: string;
  environmentId: string;
};

type CredentialRow = {
  id: string;
  secret_digest: string;
  scopes: string[];
  usable: boolean;
  installation_id: string;
  agent_id: string;
  environment_id: string;
};

const credentialPattern = /^ndr_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

const readCredential = async (manager: EntityManager, prefix: string) => {
  const [row]: CredentialRow[] = await manager.query(
    `SELECT c.id, c.secret_digest, c.scopes, i.id AS installation_id, i.agent_id,
            i.environment_id,
            c.revoked_at IS NULL
              AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
              AND i.archived_at IS NULL AND a.archived_at IS NULL
              AND w.archived_at IS NULL AS usable
     FROM nodrail.installation_credentials c
     JOIN nodrail.installations i
       ON i.workspace_id = c.workspace_id AND i.id = c.installation_id
     JOIN nodrail.agents a
       ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
     JOIN nodrail.workspaces w ON w.id = i.workspace_id
     WHERE c.public_prefix = $1`,
    [prefix],
  );
  return row;
};

async function authenticated(
  manager: EntityManager,
  prefix: string,
  secret: string,
  scope: RuntimeScope,
) {
  const found = await readCredential(manager, prefix);
  if (!found?.usable || !matchesDigest(secret, found.secret_digest))
    throw new AppError("UNAUTHENTICATED");
  if (!found.scopes.includes(scope)) throw new AppError("FORBIDDEN");
  return found;
}

/** Kept in the database so the limit holds across every server instance. */
async function countCall(
  manager: EntityManager,
  workspaceId: string,
  installationId: string,
) {
  const [row]: { calls: number }[] = await manager.query(
    `INSERT INTO nodrail.runtime_rate_windows
       (workspace_id, installation_id, window_start, calls)
     VALUES ($1, $2, date_trunc('minute', clock_timestamp()), 1)
     ON CONFLICT (workspace_id, installation_id) DO UPDATE
     SET calls = CASE
           WHEN nodrail.runtime_rate_windows.window_start = EXCLUDED.window_start
           THEN nodrail.runtime_rate_windows.calls + 1 ELSE 1 END,
         window_start = EXCLUDED.window_start
     RETURNING calls`,
    [workspaceId, installationId],
  );
  if ((row?.calls ?? 0) > RUNTIME_CALLS_PER_MINUTE)
    throw new AppError("RATE_LIMITED");
}

/**
 * For runtime calls. The credential alone decides workspace, installation, agent
 * and environment. Environment and agent are held for the whole call, in the
 * order every security step uses, so a pause, publish or revocation that commits
 * first is always seen.
 */
export async function withRuntime<T>(
  token: string,
  scope: RuntimeScope,
  run: (context: RuntimeContext) => Promise<T>,
): Promise<T> {
  const [, prefix, secret] = credentialPattern.exec(token) ?? [];
  if (!prefix || !secret) throw new AppError("UNAUTHENTICATED");
  const workspaceId = await workspaceForPrefix(
    "workspace_for_credential",
    prefix,
  );
  if (!workspaceId) throw new AppError("UNAUTHENTICATED");

  // Its own transaction, so a call waiting on locks never holds up the counter.
  await transaction({ workspaceId }, async (manager) => {
    const { installation_id: installationId } = await authenticated(
      manager,
      prefix,
      secret,
      scope,
    );
    await countCall(manager, workspaceId, installationId);
  });

  return transaction({ workspaceId }, async (manager) => {
    const found = await authenticated(manager, prefix, secret, scope);

    await manager.query(
      `SELECT 1 FROM nodrail.environments
       WHERE workspace_id = $1 AND id = $2 FOR SHARE`,
      [workspaceId, found.environment_id],
    );
    await manager.query(
      `SELECT 1 FROM nodrail.agents
       WHERE workspace_id = $1 AND id = $2 FOR SHARE`,
      [workspaceId, found.agent_id],
    );
    // Revoking takes the agent lock first, so this answer cannot go stale.
    const current = await readCredential(manager, prefix);
    if (!current?.usable) throw new AppError("UNAUTHENTICATED");

    return run({
      manager,
      workspaceId,
      credentialId: found.id,
      installationId: found.installation_id,
      agentId: found.agent_id,
      environmentId: found.environment_id,
    });
  });
}
