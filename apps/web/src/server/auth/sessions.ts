import "server-only";
import type { EntityManager } from "typeorm";
import { asAuthenticator, type HumanPrincipal } from "@/server/db/context";
import { isToken, newToken, tokenDigest } from "./token";

const SESSION_SECONDS = 30 * 24 * 60 * 60;

export type IssuedSession = { token: string; expiresAt: Date };

/** Reauthentication replaces the current browser token and leaves other devices signed in. */
export async function issueSession(
  manager: EntityManager,
  userId: string,
  previousToken?: string,
  cliOrigin?: string,
): Promise<IssuedSession> {
  if (isToken(previousToken)) await revokeToken(manager, previousToken);
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await manager.query(
    "INSERT INTO nodrail.human_sessions (user_id, token_digest, expires_at) VALUES ($1, $2, $3)",
    [userId, sessionDigest(token, cliOrigin), expiresAt],
  );
  return { token, expiresAt };
}

const sessionDigest = (token: string, cliOrigin?: string) =>
  tokenDigest(cliOrigin ? `cli:${cliOrigin}:${token}` : token);

export async function resolveSession(
  token: unknown,
  cliOrigin?: string,
): Promise<HumanPrincipal | null> {
  if (!isToken(token)) return null;
  return asAuthenticator(async (manager) => {
    const [principal]: HumanPrincipal[] = await manager.query(
      `SELECT s.user_id AS "userId", s.id AS "sessionId"
       FROM nodrail.human_sessions s JOIN nodrail.users u ON u.id = s.user_id
       WHERE s.token_digest = $1 AND s.revoked_at IS NULL
         AND s.expires_at > clock_timestamp() AND u.status = 'active'`,
      [sessionDigest(token, cliOrigin)],
    );
    return principal ?? null;
  });
}

async function revokeToken(
  manager: EntityManager,
  token: string,
  cliOrigin?: string,
) {
  await manager.query(
    `UPDATE nodrail.human_sessions SET revoked_at = clock_timestamp()
     WHERE token_digest = $1 AND revoked_at IS NULL`,
    [sessionDigest(token, cliOrigin)],
  );
}

export async function revokeSession(token: unknown, cliOrigin?: string) {
  if (isToken(token))
    await asAuthenticator((manager) => revokeToken(manager, token, cliOrigin));
}
