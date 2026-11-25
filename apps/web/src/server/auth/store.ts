import type { EntityManager } from "typeorm";

export type Account = {
  user_id: string;
  password_hash: string | null;
  status: string;
};

export async function accountFor(
  manager: EntityManager,
  email: string,
  lock = false,
) {
  const [account]: Account[] = await manager.query(
    `SELECT a.user_id, a.password_hash, u.status
     FROM nodrail.login_accounts a JOIN nodrail.users u ON u.id = a.user_id
     WHERE a.email = $1 ${lock ? "FOR UPDATE OF a" : ""}`,
    [email],
  );
  return account;
}

export async function lockEmail(manager: EntityManager, email: string) {
  await manager.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 391))",
    [email],
  );
}

export async function createVerifiedAccount(
  manager: EntityManager,
  email: string,
  passwordHash: string | null,
) {
  const display =
    (email.length <= 120 ? email : email.split("@")[0]?.slice(0, 120)) ||
    "Member";
  const [{ id }]: { id: string }[] = await manager.query(
    "INSERT INTO nodrail.users (display_name, verified_email) VALUES ($1, $2) RETURNING id",
    [display, email],
  );
  await manager.query(
    `INSERT INTO nodrail.login_accounts (user_id, email, password_hash, email_verified_at)
     VALUES ($1, $2, $3, clock_timestamp())`,
    [id, email, passwordHash],
  );
  return id;
}

export async function replacePassword(
  manager: EntityManager,
  userId: string,
  email: string,
  hash: string,
) {
  await manager.query(
    "UPDATE nodrail.login_accounts SET password_hash = $2 WHERE user_id = $1",
    [userId, hash],
  );
  await manager.query("DELETE FROM nodrail.login_links WHERE email = $1", [
    email,
  ]);
  await manager.query(
    `UPDATE nodrail.human_sessions SET revoked_at = clock_timestamp()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
