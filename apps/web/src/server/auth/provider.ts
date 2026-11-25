import "server-only";
import { asAuthenticator } from "@/server/db/context";
import { verifyPassword } from "./password";
import { issueSession } from "./sessions";
import { accountFor } from "./store";

/**
 * The password provider authenticates a person and issues the common browser
 * session. A future OIDC callback can issue the same session for a linked user.
 */
export async function passwordSignIn(
  email: string,
  password: string,
  previous?: string,
) {
  const account = await asAuthenticator((manager) =>
    accountFor(manager, email),
  );
  const hash = account?.status === "active" ? account.password_hash : null;
  if (!(await verifyPassword(password, hash)) || !account) return null;

  // A reset or erasure while the KDF was running must invalidate this attempt.
  return asAuthenticator(async (manager) => {
    const current = await accountFor(manager, email, true);
    if (
      current?.status !== "active" ||
      current.user_id !== account.user_id ||
      current.password_hash !== hash
    )
      return null;
    return issueSession(manager, current.user_id, previous);
  });
}
