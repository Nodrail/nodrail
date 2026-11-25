import "server-only";
import type { EntityManager } from "typeorm";
import type { LoginLinkKind } from "@/server/db/auth-entities";
import { asAuthenticator } from "@/server/db/context";
import { sendLoginEmail } from "./mail";
import { hashPassword } from "./password";
import { issueSession } from "./sessions";
import {
  accountFor,
  createVerifiedAccount,
  lockEmail,
  replacePassword,
} from "./store";
import { newToken, tokenDigest } from "./token";

export async function deliverLoginLink(
  email: string,
  kind: LoginLinkKind,
  allowSignup: boolean,
) {
  const token = newToken();
  const issued = await asAuthenticator(async (manager) => {
    await lockEmail(manager, email);
    const account = await accountFor(manager, email, true);
    if (
      account ? account.status !== "active" : !allowSignup || kind === "reset"
    )
      return false;
    await manager.query(
      `INSERT INTO nodrail.login_links (digest, email, user_id, kind, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + interval '15 minutes')`,
      [tokenDigest(token), email, account?.user_id ?? null, kind],
    );
    return true;
  });
  if (issued) await sendLoginEmail(email, kind, token);
}

type Link = { email: string; kind: LoginLinkKind; user_id: string | null };

async function liveLink(
  manager: EntityManager,
  digest: string,
  reset: boolean,
) {
  const [link]: Link[] = await manager.query(
    `SELECT email, kind, user_id FROM nodrail.login_links
     WHERE digest = $1 AND expires_at > clock_timestamp() AND (kind = 'reset') = $2`,
    [digest, reset],
  );
  return link;
}

export async function redeemLoginLink(
  token: string,
  options: {
    password?: string;
    previous?: string;
    canSignup: (email: string) => boolean;
  },
) {
  const digest = tokenDigest(token);
  const reset = options.password !== undefined;
  const link = await asAuthenticator((manager) =>
    liveLink(manager, digest, reset),
  );
  if (!link) return null;
  const hash =
    options.password === undefined
      ? null
      : await hashPassword(options.password);
  return asAuthenticator(async (manager) => {
    await lockEmail(manager, link.email);
    const account = await accountFor(manager, link.email, true);
    const current = await liveLink(manager, digest, reset);
    if (
      !current ||
      (account?.user_id ?? null) !== current.user_id ||
      (account ? account.status !== "active" : !options.canSignup(link.email))
    )
      return null;

    await manager.query("DELETE FROM nodrail.login_links WHERE digest = $1", [
      digest,
    ]);
    const userId =
      account?.user_id ??
      (await createVerifiedAccount(manager, link.email, null));
    if (hash) await replacePassword(manager, userId, link.email, hash);
    return issueSession(manager, userId, options.previous);
  });
}
