/** The form or button stack inside an AuthCard. */
export const authForm = "grid gap-2.5 text-left";

export const retryMessage = "Too many attempts. Please wait and try again.";

export const proxyMessage =
  "Sign-in is unavailable. Ask the server administrator to check the trusted proxy and AUTH_CLIENT_IP_HEADER.";

export function signInProblem(status: string) {
  if (status === "retry") return retryMessage;
  if (status === "proxy") return proxyMessage;
  return null;
}
