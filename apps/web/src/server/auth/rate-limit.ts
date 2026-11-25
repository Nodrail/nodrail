import "server-only";
import type { EntityManager } from "typeorm";
import { asAuthenticator } from "@/server/db/context";
import { tokenDigest } from "./token";

const limits = {
  password: { total: 120, perSource: 20, perAddress: 10, window: 900 },
  email: { total: 300, perSource: 30, perAddress: 5, window: 900 },
  redeem: { total: 300, perSource: 30, perAddress: 10, window: 900 },
};

async function take(
  manager: EntityManager,
  key: string,
  cap: number,
  seconds: number,
) {
  const rows: unknown[] = await manager.query(
    `INSERT INTO nodrail.login_rate_windows AS w (key, expires_at, attempts)
     VALUES ($1, statement_timestamp() + make_interval(secs => $3), 1)
     ON CONFLICT (key) DO UPDATE
     SET attempts = CASE WHEN w.expires_at <= statement_timestamp() THEN 1 ELSE w.attempts + 1 END,
         expires_at = CASE WHEN w.expires_at <= statement_timestamp() THEN excluded.expires_at ELSE w.expires_at END
     WHERE w.expires_at <= statement_timestamp() OR w.attempts < $2
     RETURNING key`,
    [key, cap, seconds],
  );
  return rows.length !== 0;
}

export function allowAttempt(
  kind: keyof typeof limits,
  source: string,
  subject: string,
) {
  const { total, perSource, perAddress, window } = limits[kind];
  return asAuthenticator(
    async (manager) =>
      (await take(
        manager,
        `${kind}:source:${tokenDigest(source)}`,
        perSource,
        60,
      )) &&
      (await take(
        manager,
        `${kind}:${tokenDigest(subject)}`,
        perAddress,
        window,
      )) &&
      (await take(manager, kind, total, 60)),
  );
}
