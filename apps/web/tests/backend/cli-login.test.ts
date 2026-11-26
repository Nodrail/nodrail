import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET as workspaces } from "@/app/api/v1/cli/workspaces/route";
import { GET as me } from "@/app/api/v1/me/route";
import {
  approveCliLogin,
  exchangeCliLogin,
  resolveCliSession,
  revokeCliSession,
  startCliLogin,
} from "@/server/auth/cli-login";
import { resolveSession } from "@/server/auth/sessions";
import { newToken, tokenDigest } from "@/server/auth/token";
import { Workspace, WorkspaceMembership } from "@/server/db/entities";
import { admin, createWorkspace, useDatabase } from "./world";

useDatabase();

const origin = "https://enroll.example.test";
beforeEach(() => vi.stubEnv("APP_ORIGIN", origin));
afterEach(() => vi.unstubAllEnvs());

test("the exchange requires its verifier and origin, is single use, and logs into multiple workspaces", async () => {
  const left = await createWorkspace();
  const right = await createWorkspace();
  await admin.getRepository(WorkspaceMembership).insert({
    workspaceId: right.id,
    userId: left.owner.userId,
    role: "policy_manager",
  });
  const verifier = newToken();
  const challenge = tokenDigest(verifier);
  await expect(
    startCliLogin("https://other.example.test", challenge),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await startCliLogin(origin, challenge);
  expect(await exchangeCliLogin({ verifier, origin })).toEqual({
    pending: true,
  });
  await approveCliLogin(challenge, left.owner);
  await expect(
    exchangeCliLogin({ verifier: newToken(), origin }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    exchangeCliLogin({ verifier, origin: "https://other.example.test" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const results = await Promise.allSettled([
    exchangeCliLogin({ verifier, origin }),
    exchangeCliLogin({ verifier, origin }),
  ]);
  const successes = results.filter((result) => result.status === "fulfilled");
  expect(successes).toHaveLength(1);
  const token = successes[0]!.value.token!;
  expect(token).toMatch(/^ndc_/);
  expect(await resolveSession(token.slice(4))).toBeNull();
  vi.stubEnv("APP_ORIGIN", "https://other.example.test");
  expect(await resolveCliSession(token)).toBeNull();
  vi.stubEnv("APP_ORIGIN", origin);

  for (const id of [left.id, right.id]) {
    const workspace = await admin
      .getRepository(Workspace)
      .findOneByOrFail({ id });
    const response = await me(
      new NextRequest(`${origin}/api/v1/me?workspace=${workspace.slug}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: Promise.resolve({}) },
    );
    expect(response.status).toBe(200);
    const identity = await response.json();
    expect(identity.workspace.slug).toBe(workspace.slug);
    expect(identity.effective_scopes).toEqual(
      id === left.id
        ? [
            "read",
            "rules:write",
            "agents:manage",
            "members:manage",
            "workspace:settings",
          ]
        : ["read", "rules:write"],
    );
  }
  const list = await workspaces(
    new NextRequest(`${origin}/api/v1/cli/workspaces`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  expect(list.status).toBe(200);
  expect(
    (await list.json()).items.map(({ id }: { id: string }) => id).sort(),
  ).toEqual([left.id, right.id].sort());
  await revokeCliSession(token);
  expect(await resolveCliSession(token)).toBeNull();
});
