import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as agents from "@/app/api/v1/agents/route";
import { GET as agent } from "@/app/api/v1/agents/[key]/route";
import { PATCH as changeAccess } from "@/app/api/v1/agents/[key]/access/route";
import { POST as rotate } from "@/app/api/v1/installations/[id]/credentials/rotate/route";
import { POST as revoke } from "@/app/api/v1/installations/[id]/credentials/revoke/route";
import { GET as environments } from "@/app/api/v1/environments/route";
import { GET as report } from "@/app/api/v1/insights/report/route";
import { GET as health } from "@/app/api/v1/insights/health/route";
import { GET as entries } from "@/app/api/v1/rules/entries/route";
import { GET as csrf } from "@/app/api/v1/session/csrf/route";
import { GET as team } from "@/app/api/v1/team/route";
import { GET as invite, POST as accept } from "@/app/api/v1/team/invite/route";
import { POST as issueInvite } from "@/app/api/v1/team/invites/route";
import {
  PATCH as changeRole,
  DELETE as remove,
} from "@/app/api/v1/team/members/[id]/route";
import * as tokens from "@/app/api/v1/tokens/route";
import { POST as revokeToken } from "@/app/api/v1/tokens/[id]/revoke/route";
import { POST as archive } from "@/app/api/v1/workspace/archive/route";
import { PATCH as saveSettings } from "@/app/api/v1/workspace/settings/route";
import * as workspaces from "@/app/api/v1/workspaces/route";
import { withWorkspace } from "@/server/db/context";
import { createApiToken } from "@/server/modules/api-tokens";
import {
  checkIn,
  createPerson,
  createWorkspace,
  addMember,
  useDatabase,
} from "./world";

const getPrincipal = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/current", () => ({ getPrincipal }));

useDatabase();

const origin = "https://control.example.test";

beforeEach(() => vi.stubEnv("APP_ORIGIN", origin));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
const session = { cookie: "session=valid" };

function request(
  path: string,
  {
    method = "GET",
    headers = {},
    body,
  }: {
    method?: string;
    headers?: HeadersInit;
    body?: unknown;
  } = {},
) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined)
    requestHeaders.set("content-type", "application/json");
  return new NextRequest(`${origin}/api/v1/${path}`, {
    method,
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

const segment = <P extends object>(params: P) => ({
  params: Promise.resolve(params),
});
const collection = segment({});

async function sessionWriteHeaders() {
  const response = await csrf(
    request("session/csrf", {
      headers: { ...session, "x-nodrail-csrf": "fetch" },
    }),
  );
  const token = response.cookies.get("__Host-nodrail-csrf");
  expect(token).toBeDefined();
  return {
    origin,
    cookie: `${session.cookie}; ${token!.name}=${token!.value}`,
    "x-nodrail-csrf": token!.value,
  };
}

test("creates a workspace, reads its environments, updates settings, and archives it", async () => {
  const person = await createPerson("Workspace owner");
  getPrincipal.mockResolvedValue(person);
  const headers = await sessionWriteHeaders();
  const created = await workspaces.POST(
    request("workspaces", {
      method: "POST",
      headers,
      body: { name: "Service team" },
    }),
  );
  expect(created.status).toBe(200);
  const { slug, workspace_id } = (await created.json()) as {
    slug: string;
    workspace_id: string;
  };
  const select = `?workspace=${slug}`;

  const listed = await workspaces.GET(
    request("workspaces", { headers: session }),
  );
  expect(await listed.json()).toMatchObject({
    items: [{ id: workspace_id, slug }],
  });
  const envs = await environments(
    request(`environments${select}`, { headers: session }),
    collection,
  );
  expect(await envs.json()).toMatchObject({
    items: [{ slug: "development" }, { slug: "production" }],
  });
  const body = { name: "New name", default_environment: "production" };
  const patch = (auth: HeadersInit) =>
    saveSettings(
      request(`workspace/settings${select}`, {
        method: "PATCH",
        headers: auth,
        body,
      }),
      collection,
    );
  expect((await patch(session)).status).toBe(403);
  const saved = await patch(headers);
  expect(await saved.json()).toMatchObject({ name: "New name", slug });

  const closed = await archive(
    request(`workspace/archive${select}`, {
      method: "POST",
      headers,
      body: { confirmation: "New name" },
    }),
    collection,
  );
  expect(await closed.json()).toEqual({ ok: true });
  const after = await environments(
    request(`environments${select}`, { headers: session }),
    collection,
  );
  expect(after.status).toBe(404);
});

test("scopes and live membership protect agents and isolate runtime credentials", async () => {
  const workspace = await createWorkspace();
  const owner = workspace.owner;
  const issue = (scopes: string[]) =>
    withWorkspace(owner, workspace.id, (context) =>
      createApiToken(context, {
        name: "Integration",
        scopes,
        expiresInDays: 30,
      }),
    );
  const writer = bearer((await issue(["agents:manage"])).secret);
  const reader = bearer((await issue([])).secret);
  const connect = (headers: HeadersInit) =>
    agents.POST(
      request("agents", {
        method: "POST",
        headers,
        body: { agent_key: "worker", adapter_key: "custom-sdk" },
      }),
      collection,
    );
  expect((await connect(reader)).status).toBe(403);

  const issued = await connect(writer);
  expect(issued.status).toBe(200);
  const { credential } = (await issued.json()) as {
    credential: { secret: string };
  };
  await expect(checkIn(credential.secret)).resolves.toBeDefined();
  const path = "agents/worker";
  const key = segment({ key: "worker" });
  const readerDetails = await agent(request(path, { headers: reader }), key);
  expect(await readerDetails.text()).not.toContain("credentials");
  const writerDetails = await agent(request(path, { headers: writer }), key);
  const detailText = await writerDetails.text();
  expect(detailText).not.toContain(credential.secret);
  expect(detailText).not.toContain("digest");
  const { installations } = JSON.parse(detailText) as {
    installations: { id: string; credentials: unknown[] }[];
  };
  expect(installations[0]?.credentials).toHaveLength(1);
  const id = installations[0]!.id;
  const act = (route: typeof rotate, action: string, headers = writer) =>
    route(
      request(`installations/${id}/credentials/${action}`, {
        method: "POST",
        headers,
        body: {},
      }),
      segment({ id }),
    );
  const outsider = await createWorkspace();
  const outsideToken = await withWorkspace(
    outsider.owner,
    outsider.id,
    (context) =>
      createApiToken(context, {
        name: "Outside",
        scopes: ["agents:manage"],
        expiresInDays: 30,
      }),
  );
  expect(
    (await act(rotate, "rotate", bearer(outsideToken.secret))).status,
  ).toBe(404);
  const replacement = await act(rotate, "rotate");
  expect(replacement.status).toBe(200);
  const next = (await replacement.json()) as { secret: string };
  await expect(checkIn(credential.secret)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(checkIn(next.secret)).resolves.toBeDefined();
  expect(await (await act(revoke, "revoke")).json()).toEqual({ revoked: true });
  await expect(checkIn(next.secret)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  const changed = await changeAccess(
    request(`${path}/access`, {
      method: "PATCH",
      headers: writer,
      body: { status: "paused" },
    }),
    key,
  );
  expect(await changed.json()).toEqual({ status: "paused" });
  const listing = await agents.GET(
    request("agents", { headers: reader }),
    collection,
  );
  expect(await listing.json()).toMatchObject({
    items: [{ key: "worker", access: { status: "paused" } }],
  });
});

test("a token manager uses a session and each new management scope is opt-in", async () => {
  const workspace = await createWorkspace();
  getPrincipal.mockResolvedValue(workspace.owner);
  const headers = await sessionWriteHeaders();
  const select = `?workspace=w-${workspace.id}`;
  const created = await tokens.POST(
    request(`tokens${select}`, {
      method: "POST",
      headers,
      body: {
        name: "Team automation",
        scopes: ["members:manage"],
        expires_in_days: 30,
      },
    }),
    collection,
  );
  expect(created.status).toBe(200);
  const { secret, token } = (await created.json()) as {
    secret: string;
    token: { id: string };
  };
  const list = await tokens.GET(
    request(`tokens${select}`, { headers: session }),
    collection,
  );
  expect(await list.json()).toMatchObject({
    tokens: [{ id: token.id, scopes: ["read", "members:manage"] }],
  });
  const patHeaders = bearer(secret);
  expect(
    (await tokens.GET(request("tokens", { headers: patHeaders }), collection))
      .status,
  ).toBe(401);
  expect(
    (
      await saveSettings(
        request("workspace/settings", {
          method: "PATCH",
          headers: patHeaders,
          body: { name: "Wrong", default_environment: "development" },
        }),
        collection,
      )
    ).status,
  ).toBe(403);

  const recipient = await createPerson("Invitee");
  const sendInvite = (role: string, email: string, headers = patHeaders) =>
    issueInvite(
      request("team/invites", {
        method: "POST",
        headers,
        body: { email, role },
      }),
      collection,
    );
  const deniedInvite = await sendInvite("policy_manager", recipient.email);
  expect(deniedInvite.status).toBe(403);
  expect(await deniedInvite.json()).toMatchObject({
    error: { code: "INSUFFICIENT_SCOPE" },
  });
  const invited = await sendInvite("viewer", recipient.email);
  expect(invited.status).toBe(200);
  const invitation = (await invited.json()) as { token: string };
  getPrincipal.mockResolvedValue(recipient);
  const viewed = await invite(
    request(`team/invite?token=${invitation.token}`, { headers: session }),
  );
  expect(await viewed.json()).toMatchObject({ status: "open", role: "viewer" });
  const accepted = await accept(
    request("team/invite", {
      method: "POST",
      headers: await sessionWriteHeaders(),
      body: invitation,
    }),
  );
  expect(await accepted.json()).toMatchObject({ slug: `w-${workspace.id}` });
  const teammates = await team(
    request("team", { headers: patHeaders }),
    collection,
  );
  expect(await teammates.json()).toMatchObject({
    assignable_roles: ["viewer"],
    members: expect.arrayContaining([
      expect.objectContaining({ user_id: recipient.userId, role: "viewer" }),
    ]),
  });

  const id = recipient.userId;
  const member = segment({ id });
  const promote = (headers: HeadersInit) =>
    changeRole(
      request(`team/members/${id}`, {
        method: "PATCH",
        headers,
        body: { role: "policy_manager" },
      }),
      member,
    );
  const deniedRole = await promote(patHeaders);
  expect(deniedRole.status).toBe(403);
  expect(await deniedRole.json()).toMatchObject({
    error: { code: "INSUFFICIENT_SCOPE" },
  });

  const grantToken = await withWorkspace(
    workspace.owner,
    workspace.id,
    (context) =>
      createApiToken(context, {
        name: "Role delegation",
        scopes: ["members:manage", "rules:write"],
        expiresInDays: 30,
      }),
  );
  const grantHeaders = bearer(grantToken.secret);
  const another = await createPerson("Policy invitee");
  expect(
    (await sendInvite("policy_manager", another.email, grantHeaders)).status,
  ).toBe(200);
  const patch = await promote(grantHeaders);
  expect(await patch.json()).toEqual({ changed: true });
  const deleted = await remove(
    request(`team/members/${id}`, {
      method: "DELETE",
      headers: patHeaders,
    }),
    member,
  );
  expect(await deleted.json()).toEqual({ changed: true });
  getPrincipal.mockResolvedValue(workspace.owner);
  const revoked = await revokeToken(
    request(`tokens/${token.id}/revoke${select}`, {
      method: "POST",
      headers,
      body: {},
    }),
    segment({ id: token.id }),
  );
  expect(await revoked.json()).toEqual({ ok: true });
  expect(
    (await team(request("team", { headers: patHeaders }), collection)).status,
  ).toBe(401);
});

test("rule and insight endpoints read the current workspace and reject cross-tenant sessions", async () => {
  const workspace = await createWorkspace();
  const viewer = await addMember(workspace, "viewer");
  const outsider = await createPerson("Outsider");
  const select = `workspace=w-${workspace.id}`;
  getPrincipal.mockResolvedValue(outsider);
  expect(
    (
      await entries(
        request(`rules/entries?${select}`, { headers: session }),
        collection,
      )
    ).status,
  ).toBe(404);
  getPrincipal.mockResolvedValue(viewer);
  const rules = await entries(
    request(`rules/entries?${select}`, { headers: session }),
    collection,
  );
  expect(await rules.json()).toMatchObject({ rules: [], policy_revision: 1 });
  const window = await report(
    request(`insights/report?${select}&days=7`, { headers: session }),
    collection,
  );
  expect(await window.json()).toMatchObject({ gates: [], runs: { count: 0 } });
  const status = await health(
    request(`insights/health?${select}`, { headers: session }),
    collection,
  );
  expect(await status.json()).toMatchObject({
    agents: { connected: 0 },
    stalled_steps: [],
  });
});
