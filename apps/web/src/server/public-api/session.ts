import "server-only";
import type { NextRequest } from "next/server";
import { appOrigin } from "@/server/app-origin";
import { getPrincipal } from "@/server/auth/current";
import { AppError } from "@/server/db/context";
import {
  digestSecret,
  matchesDigest,
  newSecret,
} from "@/server/security/secrets";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const csrfHeader = "x-nodrail-csrf";

function csrfCookie() {
  const secure = appOrigin().startsWith("https:");
  return {
    name: secure ? "__Host-nodrail-csrf" : "nodrail-csrf",
    secure,
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
  };
}

function assertCsrf(request: NextRequest) {
  if (request.headers.get("origin") !== appOrigin())
    throw new AppError("FORBIDDEN");
  const { name } = csrfCookie();
  // Next.js collapses duplicate names in its parsed cookie map.
  const cookiePairs = (request.headers.get("cookie") ?? "").split(";");
  const occurrences = cookiePairs.filter(
    (pair) => pair.split("=", 1)[0]?.trim() === name,
  ).length;
  const token = request.headers.get(csrfHeader) ?? "";
  const cookie = request.cookies.get(name)?.value ?? "";
  if (
    occurrences !== 1 ||
    !tokenPattern.test(token) ||
    !tokenPattern.test(cookie) ||
    !matchesDigest(token, digestSecret(cookie))
  )
    throw new AppError("FORBIDDEN");
}

/** The only management API dependency on the login implementation. */
export async function currentApiSession(request: NextRequest) {
  if (request.headers.has("authorization") || !request.headers.has("cookie"))
    throw new AppError("UNAUTHENTICATED");
  if (request.method !== "GET") assertCsrf(request);
  const principal = await getPrincipal();
  if (!principal) throw new AppError("UNAUTHENTICATED");
  return principal;
}

export function csrfToken(request: NextRequest) {
  // A cross-origin page cannot send this header without a CORS preflight.
  if (request.headers.get(csrfHeader) !== "fetch")
    throw new AppError("FORBIDDEN");
  const options = csrfCookie();
  const cookie = request.cookies.get(options.name)?.value ?? "";
  const token = tokenPattern.test(cookie) ? cookie : newSecret();
  return { token, cookie: { ...options, value: token } };
}
