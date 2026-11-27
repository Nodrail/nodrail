import "server-only";
import type { EntityManager } from "typeorm";
import { RUNTIME_CALLS_PER_MINUTE } from "@/contracts/v1/runtime";
import { matchesDigest } from "@/server/security/secrets";
import {
  AppError,
  RecordedAccessDenial,
  transaction,
  workspaceForPrefix,
} from "./context";

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
  pauseReplayKey?: string;
  enrollmentProjectId?: string | null;
  installationId: string;
  agentId: string;
  environmentId: string;
};

type CredentialRow = {
  id: string;
  secret_digest: string;
  admission_key: string;
  scopes: string[];
  usable: boolean;
  revoked_enrollment: boolean;
  installation_id: string;
  agent_id: string;
  environment_id: string;
  enrollment_project_id: string | null;
};

const credentialPattern = /^ndr_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

const readCredential = async (manager: EntityManager, prefix: string) => {
  const [row]: CredentialRow[] = await manager.query(
    `SELECT c.id, c.secret_digest, c.scopes, i.admission_key, i.id AS installation_id, i.agent_id,
            i.environment_id,
            to_jsonb(i)->>'enrollment_project_id' AS enrollment_project_id,
            c.revoked_at IS NOT NULL AND to_jsonb(i)->>'enrollment_project_id' IS NOT NULL AS revoked_enrollment,
            c.revoked_at IS NULL
              AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
              AND i.archived_at IS NULL AND i.enrollment_disabled_at IS NULL
              AND a.archived_at IS NULL
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

type RuntimeAuth = {
  prefix: string;
  secret: string;
  scope: RuntimeScope | readonly RuntimeScope[];
  confirmDisconnect: boolean;
};

async function authenticated(
  manager: EntityManager,
  { prefix, secret, scope, confirmDisconnect }: RuntimeAuth,
) {
  const found = await readCredential(manager, prefix);
  if (
    !found ||
    !(found.usable || (confirmDisconnect && found.revoked_enrollment)) ||
    !matchesDigest(secret, found.secret_digest)
  )
    throw new AppError("UNAUTHENTICATED");
  const accepted = typeof scope === "string" ? [scope] : scope;
  if (!accepted.some((value) => found.scopes.includes(value)))
    throw new AppError("FORBIDDEN");
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
  scope: RuntimeScope | readonly RuntimeScope[],
  run: (context: RuntimeContext) => Promise<T>,
  mode: "disconnect" | "normal" = "normal",
): Promise<T> {
  const [, prefix, secret] = credentialPattern.exec(token) ?? [];
  if (!prefix || !secret) throw new AppError("UNAUTHENTICATED");
  const workspaceId = await workspaceForPrefix(
    "workspace_for_credential",
    prefix,
  );
  if (!workspaceId) throw new AppError("UNAUTHENTICATED");

  const confirmDisconnect = mode === "disconnect";
  const auth = { prefix, secret, scope, confirmDisconnect };

  // Its own transaction, so a call waiting on locks never holds up the counter.
  await transaction({ workspaceId }, async (manager) => {
    const found = await authenticated(manager, auth);
    // A retry with a revoked credential cannot consume a re-enrolled machine's limit.
    if (found.usable)
      await countCall(manager, workspaceId, found.installation_id);
  });

  const result = await transaction({ workspaceId }, async (manager) => {
    const found = await authenticated(manager, auth);

    await manager.query(
      `SELECT 1 FROM nodrail.environments
       WHERE workspace_id = $1 AND id = $2 FOR SHARE`,
      [workspaceId, found.environment_id],
    );
    await manager.query(
      `SELECT 1 FROM nodrail.agents
       WHERE workspace_id = $1 AND id = $2 FOR ${confirmDisconnect ? "UPDATE" : "SHARE"}`,
      [workspaceId, found.agent_id],
    );
    // Revoking takes the agent lock first, so this answer cannot go stale.
    const current = await authenticated(manager, auth);

    try {
      return {
        value: await run({
          manager,
          workspaceId,
          credentialId: current.id,
          pauseReplayKey: current.admission_key,
          enrollmentProjectId: current.enrollment_project_id,
          installationId: found.installation_id,
          agentId: found.agent_id,
          environmentId: found.environment_id,
        }),
      };
    } catch (error) {
      if (error instanceof RecordedAccessDenial) return { error };
      throw error;
    }
  });
  if (result.error) throw result.error;
  return result.value;
}
