import "server-only";
import { cookies, headers } from "next/headers";
import {
  AUTH_RETURN_PATH_HEADER,
  safeNextPath,
} from "@/features/auth/next-path";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { HumanPrincipal } from "@/server/db/context";
import { SESSION_COOKIE } from "./cookie-name";
import { resolveSession, type IssuedSession } from "./sessions";

const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export async function currentSessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(session: IssuedSession) {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    ...cookieOptions,
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 });
}

export const getPrincipal = cache(async () =>
  resolveSession(await currentSessionToken()),
);

export async function requirePrincipal(): Promise<HumanPrincipal> {
  const principal = await getPrincipal();
  if (!principal) {
    const target = (await headers()).get(AUTH_RETURN_PATH_HEADER);
    redirect(
      target
        ? `/login?next=${encodeURIComponent(safeNextPath(target))}`
        : "/login",
    );
  }
  return principal;
}
