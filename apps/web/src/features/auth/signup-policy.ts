/**
 * While live testing, only listed addresses can create an account. Unset means
 * open. People who already have an account can always sign in.
 */
export function canCreateAccount(
  email: string,
  allowlist = process.env.SIGNUP_ALLOWLIST,
) {
  if (!allowlist?.trim()) return true;
  const allowed = allowlist.split(",").map((item) => item.trim().toLowerCase());
  return allowed.includes(email.trim().toLowerCase());
}
