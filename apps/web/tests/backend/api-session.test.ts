import { NextRequest } from "next/server";
import { afterEach, expect, test, vi } from "vitest";
import { GET as csrf } from "@/app/api/v1/session/csrf/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import { SESSION_COOKIE } from "@/server/auth/cookie-name";
import { issueSession, revokeSession } from "@/server/auth/sessions";
import { asAuthenticator } from "@/server/db/context";
import { csrfHeader } from "@/server/public-api/session";
import { createPerson, useDatabase } from "./world";

const readCookies = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: readCookies }));

useDatabase();
afterEach(() => vi.unstubAllEnvs());

const origin = "https://control.example.test";

function request(path: string, headers: HeadersInit, body?: object) {
  const req = new NextRequest(`${origin}/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body && JSON.stringify(body),
  });
  readCookies.mockResolvedValue(req.cookies);
  return req;
}

test("the management API accepts a live built-in session with CSRF and rejects it after logout", async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  const { userId } = await createPerson("Console user");
  const { token } = await asAuthenticator((manager) =>
    issueSession(manager, userId),
  );
  const cookie = `${SESSION_COOKIE}=${token}`;
  const challenge = await csrf(
    request("session/csrf", { cookie, [csrfHeader]: "fetch" }),
  );
  expect(challenge.status).toBe(200);
  const csrfCookie = challenge.cookies.get("__Host-nodrail-csrf");
  if (!csrfCookie) throw new Error("Expected a CSRF cookie");
  const pair = `${csrfCookie.name}=${csrfCookie.value}`;
  const post = (cookies: string, requestOrigin = origin) =>
    createWorkspace(
      request(
        "workspaces",
        {
          cookie: cookies,
          origin: requestOrigin,
          [csrfHeader]: csrfCookie.value,
          "content-type": "application/json",
        },
        { name: "Console workspace" },
      ),
    );

  expect((await post(`${cookie}; ${pair}; ${pair}`)).status).toBe(403);
  expect(
    (await post(`${cookie}; ${pair}`, "https://other.example.test")).status,
  ).toBe(403);
  expect((await post(`${cookie}; ${pair}`)).status).toBe(200);
  await revokeSession(token);
  expect((await post(`${cookie}; ${pair}`)).status).toBe(401);
});
