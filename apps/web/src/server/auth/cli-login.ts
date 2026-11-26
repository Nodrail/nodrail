import "server-only";
import { cliExchange } from "@/contracts/v1/cli-login";
import { appOrigin } from "@/server/app-origin";
import {
  AppError,
  asAuthenticator,
  parseInput,
  type HumanPrincipal,
} from "@/server/db/context";
import { issueSession, resolveSession, revokeSession } from "./sessions";
import { tokenDigest } from "./token";

export function cliOrigin(origin: string) {
  if (origin !== appOrigin())
    throw new AppError("FORBIDDEN", "Use the configured control-plane origin.");
  return origin;
}

export async function startCliLogin(origin: string, challenge: string) {
  await asAuthenticator((manager) =>
    manager.query(
      `INSERT INTO nodrail.cli_login_requests (challenge, origin, expires_at)
       VALUES ($1, $2, statement_timestamp() + interval '5 minutes')`,
      [challenge, cliOrigin(origin)],
    ),
  );
}

export async function waitingCliLogin(challenge: string) {
  return asAuthenticator(async (manager) => {
    const rows: unknown[] = await manager.query(
      `SELECT 1 FROM nodrail.cli_login_requests
       WHERE challenge = $1 AND origin = $2 AND user_id IS NULL
         AND expires_at > statement_timestamp()`,
      [challenge, appOrigin()],
    );
    return rows.length > 0;
  });
}

export async function approveCliLogin(
  challenge: string,
  principal: HumanPrincipal,
) {
  await asAuthenticator(async (manager) => {
    const rows: unknown[] = await manager.query(
      `WITH approved AS (
         UPDATE nodrail.cli_login_requests SET user_id = $3
         WHERE challenge = $1 AND origin = $2 AND user_id IS NULL
           AND expires_at > statement_timestamp()
         RETURNING challenge
       ) SELECT challenge FROM approved`,
      [challenge, appOrigin(), principal.userId],
    );
    if (!rows.length) throw new AppError("NOT_FOUND", "Start a new CLI login.");
  });
}

export async function exchangeCliLogin(body: unknown) {
  const input = parseInput(cliExchange, body);
  const origin = cliOrigin(input.origin);
  const challenge = tokenDigest(input.verifier);
  return asAuthenticator(async (manager) => {
    const [row]: { user_id: string | null }[] = await manager.query(
      `SELECT user_id FROM nodrail.cli_login_requests
       WHERE challenge = $1 AND origin = $2 AND expires_at > statement_timestamp()
       FOR UPDATE`,
      [challenge, origin],
    );
    if (!row) throw new AppError("NOT_FOUND", "Start a new CLI login.");
    if (!row.user_id) return { pending: true };
    await manager.query(
      "DELETE FROM nodrail.cli_login_requests WHERE challenge = $1",
      [challenge],
    );
    const session = await issueSession(manager, row.user_id, undefined, origin);
    return {
      token: `ndc_${session.token}`,
      expires_at: session.expiresAt.toISOString(),
    };
  });
}

export function resolveCliSession(token: string) {
  return resolveSession(
    token.startsWith("ndc_") ? token.slice(4) : undefined,
    appOrigin(),
  );
}

export function revokeCliSession(token: string) {
  return revokeSession(
    token.startsWith("ndc_") ? token.slice(4) : undefined,
    appOrigin(),
  );
}
