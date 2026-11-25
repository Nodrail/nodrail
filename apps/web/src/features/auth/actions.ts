"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { canCreateAccount } from "./signup-policy";
import {
  clearSessionCookie,
  currentSessionToken,
  setSessionCookie,
} from "@/server/auth/current";
import { deliverLoginLink, redeemLoginLink } from "@/server/auth/links";
import { loginEmail, newPassword } from "@/server/auth/password";
import {
  passwordWorkBusy,
  withPasswordWork,
} from "@/server/auth/password-work";
import { passwordSignIn } from "@/server/auth/provider";
import { allowAttempt } from "@/server/auth/rate-limit";
import { loginSource } from "@/server/auth/source";
import { revokeSession } from "@/server/auth/sessions";
import { isToken } from "@/server/auth/token";
import { describeError } from "@/server/log";
import { emailConfigured } from "@/server/notifications/mailer";
import { safeNextPath } from "./next-path";

const NEXT_COOKIE = "__Host-nodrail_next";
const nextOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

async function loginAllowed(
  kind: Parameters<typeof allowAttempt>[0],
  subject: string,
) {
  const source = await loginSource();
  return source !== null && (await allowAttempt(kind, source, subject));
}

export type SignInState = {
  status: "idle" | "sent" | "invalid" | "unavailable" | "retry";
};

export async function requestSignInLink(
  _previous: SignInState,
  data: FormData,
): Promise<SignInState> {
  const email = loginEmail.safeParse(data.get("email"));
  if (!email.success) return { status: "invalid" };
  if (!emailConfigured()) return { status: "unavailable" };

  const method = data.get("method");
  const kind =
    method === "reset" ? "reset" : method === "verify" ? "verify" : "sign-in";
  if (!(await loginAllowed("email", email.data))) return { status: "retry" };
  after(async () => {
    try {
      await deliverLoginLink(email.data, kind, canCreateAccount(email.data));
    } catch (error) {
      console.error("Login email failed", describeError(error));
    }
  });
  (await cookies()).set(NEXT_COOKIE, safeNextPath(data.get("next")), {
    ...nextOptions,
    maxAge: 900,
  });
  return { status: "sent" };
}

export type PasswordState = { status: "idle" | "failed" | "retry" };

export async function signInWithPassword(
  _previous: PasswordState,
  data: FormData,
): Promise<PasswordState> {
  const email = loginEmail.safeParse(data.get("email"));
  const password = newPassword.safeParse(data.get("password"));
  if (!email.success || !password.success) return { status: "failed" };
  if (!(await loginAllowed("password", email.data))) return { status: "retry" };
  const previous = await currentSessionToken();
  const session = await withPasswordWork(() =>
    passwordSignIn(email.data, password.data, previous),
  );
  if (session === passwordWorkBusy) return { status: "retry" };
  if (!session) return { status: "failed" };
  await setSessionCookie(session);
  redirect(safeNextPath(data.get("next")));
}

export type ConfirmState = { status: "idle" | "failed" | "retry" | "password" };

/** A POST, so a mail scanner that fetches the link cannot use it up. */
export async function confirmSignIn(
  _previous: ConfirmState,
  data: FormData,
): Promise<ConfirmState> {
  const token = data.get("token");
  if (!emailConfigured() || !isToken(token)) return { status: "failed" };
  const reset = data.get("mode") === "reset";
  const password = reset
    ? newPassword.safeParse(data.get("password"))
    : undefined;
  if (password && !password.success) return { status: "password" };

  if (!(await loginAllowed("redeem", token))) return { status: "retry" };
  const previous = await currentSessionToken();
  const redeem = () =>
    redeemLoginLink(token, {
      password: password?.data,
      previous,
      canSignup: canCreateAccount,
    });
  const session = reset ? await withPasswordWork(redeem) : await redeem();
  if (session === passwordWorkBusy) return { status: "retry" };
  if (!session) return { status: "failed" };
  await setSessionCookie(session);

  const store = await cookies();
  const next = safeNextPath(store.get(NEXT_COOKIE)?.value);
  store.set(NEXT_COOKIE, "", { ...nextOptions, maxAge: 0 });
  redirect(next);
}

export async function signOut() {
  await revokeSession(await currentSessionToken());
  await clearSessionCookie();
  redirect("/login");
}
