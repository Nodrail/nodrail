import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  apiTokenScopes,
  createApiTokenInput,
  MAX_LIVE_TOKENS,
  scopeCapability,
  type ApiTokenDto,
  type ApiTokenListDto,
  type ApiTokenScope,
  type IssuedApiTokenDto,
} from "@/contracts/v1/api-tokens";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { PersonalAccessToken } from "@/server/db/token-entities";
import { recordAudit } from "@/server/modules/audit";
import { digestSecret, newSecret } from "@/server/security/secrets";

const tokenRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  owner_name: z.string(),
  name: z.string(),
  public_prefix: z.string(),
  scopes: z.array(z.enum(apiTokenScopes)),
  created_at: z.date(),
  expires_at: z.date().nullable(),
  last_used_at: z.date().nullable(),
  revoked_at: z.date().nullable(),
});

const tokenSelect = `
  SELECT t.id, t.user_id, u.display_name AS owner_name, t.name, t.public_prefix,
         t.scopes, t.created_at, t.expires_at, t.last_used_at, t.revoked_at
  FROM nodrail.personal_access_tokens t
  JOIN nodrail.users u ON u.id = t.user_id`;

const toDto = (
  row: z.infer<typeof tokenRow>,
  context: WorkspaceContext,
): ApiTokenDto => ({
  id: row.id,
  name: row.name,
  prefix: `ndp_${row.public_prefix}`,
  scopes: row.scopes,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at?.toISOString() ?? null,
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
  revokedAt: row.revoked_at?.toISOString() ?? null,
  owner: row.owner_name,
  mine: row.user_id === context.principal.userId,
});

/** A token is managed from a signed-in screen, never with another token. */
function requireSession(context: WorkspaceContext) {
  if ("tokenId" in context.principal) throw new AppError("FORBIDDEN");
}

/** The scopes this person's role lets a token use now. */
const grantableScopes = (context: WorkspaceContext): ApiTokenScope[] =>
  apiTokenScopes.filter((scope) =>
    context.capabilities.has(scopeCapability[scope]),
  );

const DAY_MS = 86_400_000;

const describeScopes = (scopes: readonly string[]) => scopes.join(", ");

export async function listApiTokens(
  context: WorkspaceContext,
): Promise<ApiTokenListDto> {
  requireCapability(context, "workspace:read");
  const seesEveryone = context.capabilities.has("members:manage");
  const rows = parseRows(
    tokenRow,
    await context.manager.query(
      `${tokenSelect}
       WHERE t.workspace_id = $1 AND ($3 OR t.user_id = $2)
       ORDER BY t.revoked_at IS NOT NULL, t.created_at DESC, t.id DESC
       LIMIT 100`,
      [context.workspaceId, context.principal.userId, seesEveryone],
    ),
  );
  return {
    tokens: rows.map((row) => toDto(row, context)),
    grantable: grantableScopes(context),
    seesEveryone,
  };
}

async function liveTokens(context: WorkspaceContext) {
  const [row]: { count: number }[] = await context.manager.query(
    `SELECT count(*)::int AS count FROM nodrail.personal_access_tokens
     WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
    [context.workspaceId, context.principal.userId],
  );
  return row?.count ?? 0;
}

/**
 * Issues a token for the person creating it. It can only carry scopes their
 * role grants now, and is shown once: only its digest is kept.
 */
export async function createApiToken(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<IssuedApiTokenDto> {
  requireCapability(context, "workspace:read");
  requireSession(context);
  const input = parseInput(createApiTokenInput, rawInput);
  const grantable = grantableScopes(context);
  if (input.scopes.some((scope) => !grantable.includes(scope)))
    throw new AppError("FORBIDDEN");
  if ((await liveTokens(context)) >= MAX_LIVE_TOKENS)
    throw new AppError("INVALID_INPUT");

  const prefix = randomBytes(6).toString("hex");
  const secret = newSecret();
  const { identifiers } = await context.manager.insert(PersonalAccessToken, {
    workspaceId: context.workspaceId,
    userId: context.principal.userId,
    name: input.name,
    publicPrefix: prefix,
    secretDigest: digestSecret(secret),
    scopes: input.scopes,
    expiresAt: input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * DAY_MS)
      : null,
  });
  await recordAudit(context, {
    eventType: "api_token.created",
    decisionCode: "api_token_created",
    payload: { subject: input.name, detail: describeScopes(input.scopes) },
  });
  const id = z.uuid().parse(identifiers[0]?.id);
  const [row] = parseRows(
    tokenRow,
    await context.manager.query(
      `${tokenSelect} WHERE t.workspace_id = $1 AND t.id = $2`,
      [context.workspaceId, id],
    ),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return { token: toDto(row, context), secret: `ndp_${prefix}_${secret}` };
}

/**
 * Ends a token now. Its person can revoke it, and so can whoever manages
 * members. A call already holding the token finishes; the next is refused.
 */
export async function revokeApiToken(
  context: WorkspaceContext,
  tokenId: unknown,
): Promise<void> {
  requireCapability(context, "workspace:read");
  requireSession(context);
  const id = z.uuid().safeParse(tokenId);
  if (!id.success) throw new AppError("NOT_FOUND");
  const [row] = parseRows(
    tokenRow,
    await context.manager.query(
      `${tokenSelect} WHERE t.workspace_id = $1 AND t.id = $2 FOR UPDATE OF t`,
      [context.workspaceId, id.data],
    ),
  );
  const mine = row?.user_id === context.principal.userId;
  if (!row || (!mine && !context.capabilities.has("members:manage")))
    throw new AppError("NOT_FOUND");
  if (row.revoked_at) return;
  await context.manager.query(
    `UPDATE nodrail.personal_access_tokens
     SET revoked_at = clock_timestamp(), revoked_by = $3
     WHERE workspace_id = $1 AND id = $2`,
    [context.workspaceId, row.id, context.principal.userId],
  );
  await recordAudit(context, {
    eventType: "api_token.revoked",
    decisionCode: "api_token_revoked",
    payload: {
      subject: mine ? row.name : `${row.name} (${row.owner_name})`,
      detail: describeScopes(row.scopes),
    },
  });
}

/** A person leaving a workspace takes their tokens with them. */
export async function revokeTokensOf(
  context: WorkspaceContext,
  userId: string,
) {
  await context.manager.query(
    `UPDATE nodrail.personal_access_tokens
     SET revoked_at = clock_timestamp(), revoked_by = $3
     WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [context.workspaceId, userId, context.principal.userId],
  );
}
