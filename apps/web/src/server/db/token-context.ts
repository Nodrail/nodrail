import "server-only";
import type { EntityManager } from "typeorm";
import {
  API_CALLS_PER_MINUTE,
  capabilitiesForToken,
  type ApiTokenScope,
} from "@/contracts/v1/api-tokens";
import { matchesDigest } from "@/server/security/secrets";
import {
  AppError,
  memberContext,
  transaction,
  workspaceForPrefix,
  type TokenPrincipal,
  type WorkspaceContext,
} from "./context";

export const personalTokenPattern = /^ndp_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

/** Reads see what this person's screens see; changes check as screens do. */
export type ApiAccess = "read" | "write";

export type TokenDetails = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

export type TokenContext = WorkspaceContext & {
  token: TokenDetails;
};

type TokenRow = {
  id: string;
  user_id: string;
  name: string;
  scopes: ApiTokenScope[];
  secret_digest: string;
  created_at: Date;
  expires_at: Date | null;
  last_used_at: Date | null;
  usable: boolean;
};

/**
 * Usable only while it is live and its person is still an active member of a
 * workspace that is not archived. Locked when `lock`, so a revocation or
 * removal that commits first is always seen.
 */
async function readToken(manager: EntityManager, prefix: string, lock = false) {
  const [row]: TokenRow[] = await manager.query(
    `SELECT t.id, t.user_id, t.name, t.scopes, t.secret_digest, t.created_at,
            t.expires_at, t.last_used_at,
            t.revoked_at IS NULL
              AND (t.expires_at IS NULL OR t.expires_at > clock_timestamp())
              AND w.archived_at IS NULL AND u.status = 'active'
              AND m.status = 'active' AS usable
     FROM nodrail.personal_access_tokens t
     JOIN nodrail.workspaces w ON w.id = t.workspace_id
     JOIN nodrail.users u ON u.id = t.user_id
     JOIN nodrail.workspace_memberships m
       ON m.workspace_id = t.workspace_id AND m.user_id = t.user_id
     WHERE t.public_prefix = $1
     ${lock ? "FOR SHARE OF t" : ""}`,
    [prefix],
  );
  return row;
}

async function authenticated(
  manager: EntityManager,
  credentials: { prefix: string; secret: string },
  lock = false,
) {
  const found = await readToken(manager, credentials.prefix, lock);
  if (!found?.usable || !matchesDigest(credentials.secret, found.secret_digest))
    throw new AppError("UNAUTHENTICATED");
  return found;
}

/** One minute's calls, kept on the token so the limit holds across servers. */
async function countCall(
  manager: EntityManager,
  workspaceId: string,
  id: string,
) {
  // Read through a SELECT: TypeORM answers a bare UPDATE with a row count too.
  const [row]: { calls: number }[] = await manager.query(
    `WITH counted AS (
       UPDATE nodrail.personal_access_tokens
       SET rate_window_calls = CASE
             WHEN rate_window_start = date_trunc('minute', clock_timestamp())
             THEN rate_window_calls + 1 ELSE 1 END,
           rate_window_start = date_trunc('minute', clock_timestamp()),
           last_used_at = clock_timestamp()
       WHERE workspace_id = $1 AND id = $2
       RETURNING rate_window_calls)
     SELECT rate_window_calls AS calls FROM counted`,
    [workspaceId, id],
  );
  if ((row?.calls ?? 0) > API_CALLS_PER_MINUTE)
    throw new AppError("RATE_LIMITED");
}

/** What the person's role grants now, limited to what the token was given. */
function narrowed(context: WorkspaceContext, scopes: ApiTokenScope[]) {
  const allowed = capabilitiesForToken(scopes);
  return new Set(
    [...context.capabilities].filter((capability) => allowed.has(capability)),
  );
}

async function asTokenPerson(
  manager: EntityManager,
  workspaceId: string,
  found: TokenRow,
  prefix: string,
): Promise<TokenContext> {
  const principal: TokenPrincipal = {
    userId: found.user_id,
    tokenId: found.id,
    tokenName: found.name,
  };
  const member = await memberContext(manager, principal, workspaceId).catch(
    (error: unknown) => {
      throw error instanceof AppError && error.code === "NOT_FOUND"
        ? new AppError("UNAUTHENTICATED")
        : error;
    },
  );
  return {
    ...member,
    principal,
    capabilities: narrowed(member, found.scopes),
    token: {
      id: found.id,
      name: found.name,
      prefix: `ndp_${prefix}`,
      scopes: found.scopes,
      createdAt: found.created_at,
      expiresAt: found.expires_at,
      lastUsedAt: found.last_used_at,
    },
  };
}

/**
 * For the personal API. The token alone decides workspace and person. It is
 * checked, counted, then checked again under lock with the live membership,
 * so a revocation, removal or lower role that commits first always applies.
 */
export async function withPersonalToken<T>(
  token: string,
  needs: { scope: ApiTokenScope; access: ApiAccess },
  run: (context: TokenContext) => Promise<T>,
): Promise<T> {
  const [, prefix, secret] = personalTokenPattern.exec(token) ?? [];
  if (!prefix || !secret) throw new AppError("UNAUTHENTICATED");
  const workspaceId = await workspaceForPrefix(
    "workspace_for_personal_token",
    prefix,
  );
  if (!workspaceId) throw new AppError("UNAUTHENTICATED");

  // Its own transaction, so a call waiting on locks never holds up the counter.
  const userId = await transaction({ workspaceId }, async (manager) => {
    const found = await authenticated(manager, { prefix, secret });
    await countCall(manager, workspaceId, found.id);
    if (!found.scopes.includes(needs.scope))
      throw new AppError("INSUFFICIENT_SCOPE", `Requires ${needs.scope}.`);
    return found.user_id;
  });

  return transaction({ userId, workspaceId }, async (manager) => {
    const found = await authenticated(manager, { prefix, secret }, true);
    const context = await asTokenPerson(manager, workspaceId, found, prefix);
    if (needs.access === "read")
      await manager.query("SET LOCAL ROLE nodrail_member_read");
    return run(context);
  });
}
