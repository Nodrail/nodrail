import "server-only";
import { asAuthenticator } from "@/server/db/context";

export function pruneLoginState() {
  return asAuthenticator(async (manager) => {
    await manager.query(
      "DELETE FROM nodrail.cli_login_requests WHERE expires_at <= statement_timestamp()",
    );
    const [, links]: [unknown, number] = await manager.query(
      "DELETE FROM nodrail.login_links WHERE expires_at <= statement_timestamp()",
    );
    const [, attempts]: [unknown, number] = await manager.query(
      "DELETE FROM nodrail.login_rate_windows WHERE expires_at <= statement_timestamp()",
    );
    const [, sessions]: [unknown, number] = await manager.query(
      `DELETE FROM nodrail.human_sessions
       WHERE token_digest IS NOT NULL
         AND (expires_at <= statement_timestamp() OR revoked_at <= statement_timestamp() - interval '1 day')`,
    );
    return {
      loginLinks: links,
      loginRateWindows: attempts,
      loginSessions: sessions,
    };
  });
}
