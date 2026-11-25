import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "@/app/api/v1/session/csrf/route";
import { currentApiSession, csrfHeader } from "@/server/public-api/session";
import { readBody } from "@/server/http/api";

const getPrincipal = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/current", () => ({ getPrincipal }));

const origin = "https://control.example.test";
const url = `${origin}/api/v1/session/csrf`;
const sessionCookie = "session=login";
const principal = { userId: "user", sessionId: "session" };

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", origin);
  getPrincipal.mockResolvedValue(principal);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

async function issue() {
  const response = await GET(
    new NextRequest(url, {
      headers: { cookie: sessionCookie, [csrfHeader]: "fetch" },
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const cookie = response.cookies.get("__Host-nodrail-csrf");
  expect(cookie).toMatchObject({
    secure: true,
    path: "/",
    httpOnly: true,
    sameSite: "strict",
  });
  expect(await response.json()).toEqual({ token: cookie?.value });
  return cookie!;
}

test("requires a session and a custom header to issue a double-submit token", async () => {
  expect((await GET(new NextRequest(url))).status).toBe(401);
  expect(
    (await GET(new NextRequest(url, { headers: { cookie: sessionCookie } })))
      .status,
  ).toBe(403);
  const token = await issue();
  const refreshed = await GET(
    new NextRequest(url, {
      headers: {
        cookie: `${sessionCookie}; ${token.name}=${token.value}`,
        [csrfHeader]: "fetch",
      },
    }),
  );
  expect(await refreshed.json()).toEqual({ token: token.value });
});

test("requires a matching double-submit token and configured origin on writes", async () => {
  const { name, value } = await issue();
  const cookie = `${sessionCookie}; ${name}=${value}`;
  const run = (headers: Record<string, string>) =>
    currentApiSession(
      new NextRequest("https://untrusted-host.example.test/api/v1/tokens", {
        method: "POST",
        headers: { cookie, ...headers },
      }),
    );
  await expect(run({ origin, [csrfHeader]: value })).resolves.toEqual(
    principal,
  );
  for (const headers of [
    { origin },
    { [csrfHeader]: value },
    { origin, [csrfHeader]: "a".repeat(43) },
    { origin, [csrfHeader]: value, cookie: sessionCookie },
    { origin: "https://other.example.test", [csrfHeader]: value },
    { origin: "null", [csrfHeader]: value },
  ]) {
    await expect(
      run(Object.fromEntries(new Headers(headers as HeadersInit))),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

test("rejects duplicate CSRF cookie names even when the last one matches", async () => {
  const { name, value } = await issue();
  const request = new NextRequest(url, {
    method: "POST",
    headers: {
      origin,
      cookie: `${sessionCookie}; ${name}=stale; ${name}=${value}`,
      [csrfHeader]: value,
    },
  });
  await expect(currentApiSession(request)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});

test("refuses mixed authentication and missing sessions", async () => {
  const run = (headers: HeadersInit) =>
    currentApiSession(new NextRequest(url, { headers }));
  await expect(
    run({ cookie: sessionCookie, authorization: "Bearer token" }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  getPrincipal.mockResolvedValue(null);
  await expect(run({ cookie: sessionCookie })).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

test("a DELETE uses the route parameters without requiring a JSON body", async () => {
  await expect(
    readBody(new NextRequest(url, { method: "DELETE" }), 64),
  ).resolves.toBeUndefined();
});
