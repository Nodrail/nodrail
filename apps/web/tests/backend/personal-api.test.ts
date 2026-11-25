import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { API_CALLS_PER_MINUTE } from "@/contracts/v1/api-tokens";
import { readWorkspace, withWorkspace } from "@/server/db/context";
import { PersonalAccessToken } from "@/server/db/token-entities";
import { withPersonalToken } from "@/server/db/token-context";
import { listActivity } from "@/server/modules/activity";
import {
  createApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/server/modules/api-tokens";
import { changeMemberRole, removeMember } from "@/server/modules/team/members";
import * as me from "@/app/api/v1/me/route";
import * as activity from "@/app/api/v1/activity/route";
import * as activityEvent from "@/app/api/v1/activity/[id]/route";
import * as runs from "@/app/api/v1/runs/route";
import * as run from "@/app/api/v1/runs/[id]/route";
import * as insights from "@/app/api/v1/insights/route";
import * as rules from "@/app/api/v1/rules/route";
import { GET as readLivePolicy } from "@/app/api/v1/rules/live/route";
import * as preview from "@/app/api/v1/rules/preview/route";
import * as publish from "@/app/api/v1/rules/publish/route";
import { PATCH as saveSettings } from "@/app/api/v1/workspace/settings/route";
import * as runtimeAction from "@/app/api/v1/runtime/actions/[id]/route";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

type Handler = (
  request: NextRequest,
  segment: { params: Promise<{ id: string }> },
) => Promise<Response>;

type Call = {
  method?: string;
  token?: string;
  query?: Record<string, string>;
  body?: unknown;
  id?: string;
  headers?: Record<string, string>;
};

/** Calls a route handler the way Next does, and reads its JSON answer. */
async function call(handler: Handler, path: string, options: Call = {}) {
  const url = new URL(`http://localhost/api/v1/${path}`);
  for (const [key, value] of Object.entries(options.query ?? {}))
    url.searchParams.append(key, value);
  const headers = new Headers(options.headers);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  const request = new NextRequest(url, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await handler(request, {
    params: Promise.resolve({ id: options.id ?? "" }),
  });
  // oxlint-disable-next-line typescript/no-explicit-any -- answers are checked by shape
  return { status: response.status, json: (await response.json()) as any };
}

const errorCode = async (
  answer: Promise<{ json: { error?: { code: string } } }>,
) => (await answer).json.error?.code;

async function issue(
  w: TestWorkspace,
  person: Person,
  scopes: string[] = [],
  name = "laptop",
) {
  return withWorkspace(person, w.id, (context) =>
    createApiToken(context, { name, scopes, expiresInDays: 90 }),
  );
}

describe("personal access tokens", () => {
  test("are shown once and stored only as a digest", async () => {
    const w = await createWorkspace();
    const { secret, token } = await issue(w, w.owner);
    expect(secret).toMatch(/^ndp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect(secret.startsWith(token.prefix)).toBe(true);
    const row = await admin
      .getRepository(PersonalAccessToken)
      .findOneByOrFail({ id: token.id });
    expect(row.secretDigest).toBe(
      createHash("sha256").update(secret.slice(17)).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(secret.slice(17));
    const list = await readWorkspace(w.owner, w.id, listApiTokens);
    expect(JSON.stringify(list)).not.toContain(secret.slice(17));
    expect(list.tokens[0]).toMatchObject({ name: "laptop", lastUsedAt: null });
    expect(token.scopes).toEqual(["read"]);
  });

  test("default to 90 days and record when they were last used", async () => {
    const w = await createWorkspace();
    const { secret, token } = await issue(w, w.owner);
    const days =
      (new Date(token.expiresAt!).getTime() -
        new Date(token.createdAt).getTime()) /
      86_400_000;
    expect(Math.round(days)).toBe(90);
    const answer = await call(me.GET as Handler, "me", { token: secret });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      token: { name: "laptop", scopes: ["read"] },
      person: { name: "Owner" },
      role: "admin",
      can: { read: true, rules_write: false },
    });
    expect(answer.json.environments).toContainEqual({
      slug: "development",
      name: expect.any(String),
      default: true,
    });
    const list = await readWorkspace(w.owner, w.id, listApiTokens);
    expect(list.tokens[0]?.lastUsedAt).not.toBeNull();
  });

  test("stop working when revoked or expired, and both are audited", async () => {
    const w = await createWorkspace();
    const revoked = await issue(w, w.owner, [], "one");
    const expired = await issue(w, w.owner, [], "two");
    expect(
      (await call(me.GET as Handler, "me", { token: revoked.secret })).status,
    ).toBe(200);
    await withWorkspace(w.owner, w.id, (context) =>
      revokeApiToken(context, revoked.token.id),
    );
    await admin.query(
      `UPDATE nodrail.personal_access_tokens
       SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
       WHERE id = $1`,
      [expired.token.id],
    );
    for (const secret of [revoked.secret, expired.secret])
      expect(
        await errorCode(call(me.GET as Handler, "me", { token: secret })),
      ).toBe("UNAUTHENTICATED");
    const codes = (
      await admin.query(
        `SELECT decision_code FROM nodrail.audit_events WHERE workspace_id = $1`,
        [w.id],
      )
    ).map((row: { decision_code: string }) => row.decision_code);
    expect(
      codes.filter((code: string) => code === "api_token_created"),
    ).toHaveLength(2);
    expect(codes).toContain("api_token_revoked");
  });

  test("a wrong secret with a real prefix is refused", async () => {
    const w = await createWorkspace();
    const { secret } = await issue(w, w.owner);
    const forged = `${secret.slice(0, 17)}${"A".repeat(43)}`;
    expect(
      await errorCode(call(me.GET as Handler, "me", { token: forged })),
    ).toBe("UNAUTHENTICATED");
  });

  test("only carry scopes the person's role grants", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    // Nothing waits for a person, so there is no scope to decide with.
    await expect(issue(w, viewer, ["decide"])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(issue(w, viewer, ["rules:write"])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { grantable } = await readWorkspace(viewer, w.id, listApiTokens);
    // A reporting token is anyone's: it reports their own machines.
    expect(grantable).toEqual(["read", "inventory:write"]);
  });

  test("a token cannot create tokens", async () => {
    const w = await createWorkspace();
    const { secret } = await issue(w, w.owner);
    await expect(
      withPersonalToken(secret, { scope: "read", access: "write" }, (context) =>
        createApiToken(context, { name: "x", scopes: [], expiresInDays: 30 }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("admins see and revoke everyone's; others only their own", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    const theirs = await issue(w, manager, ["rules:write"], "theirs");
    await issue(w, w.owner, [], "mine");
    const own = await readWorkspace(manager, w.id, listApiTokens);
    expect(own.tokens.map((token) => token.name)).toEqual(["theirs"]);
    const all = await readWorkspace(w.owner, w.id, listApiTokens);
    expect(all.tokens.map((token) => token.name).sort()).toEqual([
      "mine",
      "theirs",
    ]);
    const other = await addMember(w, "viewer");
    await expect(
      withWorkspace(other, w.id, (context) =>
        revokeApiToken(context, theirs.token.id),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await withWorkspace(w.owner, w.id, (context) =>
      revokeApiToken(context, theirs.token.id),
    );
    expect(
      await errorCode(call(me.GET as Handler, "me", { token: theirs.secret })),
    ).toBe("UNAUTHENTICATED");
  });

  test("end when their person leaves the workspace", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    const { secret, token } = await issue(w, manager, ["rules:write"]);
    await withWorkspace(w.owner, w.id, (context) =>
      removeMember(context, manager.userId),
    );
    expect(
      await errorCode(call(me.GET as Handler, "me", { token: secret })),
    ).toBe("UNAUTHENTICATED");
    const row = await admin
      .getRepository(PersonalAccessToken)
      .findOneByOrFail({ id: token.id });
    expect(row.revokedAt).not.toBeNull();
  });
});

describe("authentication", () => {
  test("refuses agent credentials, cookies and missing tokens", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "bot");
    const credential = await issueToken(w, agent);
    const { secret } = await issue(w, w.owner);
    expect(
      await errorCode(call(me.GET as Handler, "me", { token: credential })),
    ).toBe("UNAUTHENTICATED");
    expect(await errorCode(call(me.GET as Handler, "me"))).toBe(
      "UNAUTHENTICATED",
    );
    expect(
      await errorCode(
        call(me.GET as Handler, "me", {
          token: secret,
          headers: { cookie: "sb=1" },
        }),
      ),
    ).toBe("UNAUTHENTICATED");
  });

  test("a personal token cannot call the runtime API", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "bot");
    const { secret } = await issue(w, w.owner, ["rules:write"]);
    const answer = await call(
      runtimeAction.GET as Handler,
      "runtime/actions/x",
      {
        token: secret,
        id: agent.actionId,
      },
    );
    expect(answer.status).toBe(401);
    expect(answer.json.error.code).toBe("UNAUTHENTICATED");
  });

  test("limits each token to its calls per minute", async () => {
    const w = await createWorkspace();
    const { secret, token } = await issue(w, w.owner);
    await admin.query(
      `UPDATE nodrail.personal_access_tokens
       SET rate_window_start = date_trunc('minute', clock_timestamp()),
           rate_window_calls = $2
       WHERE id = $1`,
      [token.id, API_CALLS_PER_MINUTE],
    );
    const answer = await call(me.GET as Handler, "me", { token: secret });
    expect(answer.status).toBe(429);
    expect(answer.json.error).toMatchObject({
      code: "RATE_LIMITED",
      request_id: expect.any(String),
    });
  });
});

describe("scopes", () => {
  test("a read token reads everything and changes nothing", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const { secret } = await issue(w, w.owner);
    const reads: [Handler, string, string?][] = [
      [activity.GET as Handler, "activity"],
      [runs.GET as Handler, "runs"],
      [insights.GET as Handler, "insights"],
      [rules.GET as Handler, "rules"],
    ];
    for (const [handler, path, id] of reads)
      expect((await call(handler, path, { token: secret, id })).status).toBe(
        200,
      );
    expect(
      await errorCode(
        call(preview.POST as Handler, "rules/preview", {
          token: secret,
          body: { yaml: "[]" },
        }),
      ),
    ).toBe("INSUFFICIENT_SCOPE");
    expect(
      await errorCode(
        call(publish.POST as Handler, "rules/publish", {
          token: secret,
          body: { yaml: "[]", policy_revision: 1, file_digest: "x" },
        }),
      ),
    ).toBe("INSUFFICIENT_SCOPE");
  });

  test("lists answer in snake_case and pass agent data through", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const { secret } = await issue(w, w.owner);
    const { json } = await call(activity.GET as Handler, "activity", {
      token: secret,
      query: { kind: "decisions" },
    });
    expect(json.items[0]).toMatchObject({
      agent_key: "bot",
      action: { tool_key: "github", reference: expect.stringMatching(/^REQ-/) },
    });
  });

  test("a lower role takes effect on the next call, whatever the scopes", async () => {
    const w = await createWorkspace();
    const manager = await addMember(w, "policy_manager");
    const { secret } = await issue(w, manager, ["rules:write"]);
    const meBefore = await call(me.GET as Handler, "me", { token: secret });
    expect(meBefore.json.can.rules_write).toBe(true);
    await withWorkspace(w.owner, w.id, (context) =>
      changeMemberRole(context, { userId: manager.userId, role: "viewer" }),
    );
    const meAfter = await call(me.GET as Handler, "me", { token: secret });
    expect(meAfter.json).toMatchObject({
      role: "viewer",
      can: { rules_write: false },
    });
    expect(
      await errorCode(
        call(preview.POST as Handler, "rules/preview", {
          token: secret,
          body: { yaml: "[]" },
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  test("rules:write previews and publishes exactly what was previewed", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const { secret } = await issue(w, w.owner, ["rules:write"], "rules-bot");
    const current = await call(rules.GET as Handler, "rules", {
      token: secret,
    });
    expect(current.json.environment).toBe("development");
    const yaml = `- rule: Read issues
  tool: github
  operation: issues.read
  resource: { kind: issue, match: any }
  effect: allow
`;
    const previewed = await call(preview.POST as Handler, "rules/preview", {
      token: secret,
      body: { yaml },
    });
    expect(previewed.json).toMatchObject({
      issues: [],
      added: ["Read issues"],
    });
    expect(
      await errorCode(
        call(publish.POST as Handler, "rules/publish", {
          token: secret,
          body: {
            yaml: `${yaml}\n`,
            policy_revision: previewed.json.policy_revision,
            file_digest: previewed.json.file_digest,
          },
        }),
      ),
    ).toBe("RULE_CHANGED");
    const published = await call(publish.POST as Handler, "rules/publish", {
      token: secret,
      body: {
        yaml,
        policy_revision: previewed.json.policy_revision,
        file_digest: previewed.json.file_digest,
      },
    });
    expect(published.json).toMatchObject({ added: 1 });
    const after = await call(rules.GET as Handler, "rules", { token: secret });
    expect(after.json.yaml).toContain("Read issues");
    const { items } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, "development", { kind: "changes" }),
    );
    expect(items.find((item) => item.code === "rules_applied")?.actor.via).toBe(
      "rules-bot",
    );
  });

  test("a default environment change cannot redirect a previewed publish", async () => {
    const w = await createWorkspace();
    const { secret: writer } = await issue(w, w.owner, ["rules:write"]);
    const { secret: settings } = await issue(w, w.owner, [
      "workspace:settings",
    ]);
    const yaml = `- rule: Read development issues
  tool: github
  operation: issues.read
  resource: { kind: issue, match: any }
  effect: allow
`;
    const { json: checked } = await call(preview.POST, "rules/preview", {
      token: writer,
      body: { yaml },
    });
    expect(checked).toMatchObject({
      issues: [],
      added: ["Read development issues"],
    });
    const switched = await call(saveSettings, "workspace/settings", {
      method: "PATCH",
      token: settings,
      body: { name: "Test", default_environment: "production" },
    });
    expect(switched.status).toBe(200);

    const liveRules = () =>
      call(readLivePolicy, "rules/live", { token: writer });
    const before = await liveRules();
    expect(before.json).toMatchObject({
      environment: "production",
      policy_revision: checked.policy_revision,
    });
    const body = {
      yaml,
      policy_revision: checked.policy_revision,
      file_digest: checked.file_digest,
    };
    const redirected = await call(publish.POST, "rules/publish", {
      token: writer,
      body,
    });
    expect(redirected.status).toBe(409);
    expect(redirected.json.error.code).toBe("RULE_CHANGED");
    const original = await call(publish.POST, "rules/publish", {
      token: writer,
      query: { environment: "development" },
      body,
    });
    expect(original.json).toMatchObject({ added: 1 });
    expect((await liveRules()).json).toEqual(before.json);
  });
});

describe("requests", () => {
  test("bodies, filters and query parameters are strict", async () => {
    const w = await createWorkspace();
    await createAgent(w, "bot");
    const { secret } = await issue(w, w.owner, ["rules:write"]);
    const extra = await call(preview.POST as Handler, "rules/preview", {
      token: secret,
      body: { yaml: "[]", always: true },
    });
    expect(extra.json.error.code).toBe("INVALID_INPUT");
    for (const query of [
      // Nothing waits any more, so "waiting" is no outcome.
      { outcome: "waiting" } as Record<string, string>,
      { outcome: "maybe" } as Record<string, string>,
      { colour: "red" },
      { limit: "500" },
    ])
      expect(
        await errorCode(
          call(activity.GET as Handler, "activity", { token: secret, query }),
        ),
      ).toBe("INVALID_INPUT");
    const notJson = new NextRequest("http://localhost/api/v1/rules/preview", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "text/plain",
      },
      body: "yaml: 1",
    });
    const response = await (preview.POST as Handler)(notJson, {
      params: Promise.resolve({ id: "" }),
    });
    expect(response.status).toBe(422);
  });

  test("an unknown environment is not found", async () => {
    const w = await createWorkspace();
    const { secret } = await issue(w, w.owner);
    expect(
      await errorCode(
        call(activity.GET as Handler, "activity", {
          token: secret,
          query: { environment: "nowhere" },
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  test("activity pages with a cursor", async () => {
    const w = await createWorkspace();
    await createAgent(w, "one");
    await createAgent(w, "two");
    const { secret } = await issue(w, w.owner);
    const first = await call(activity.GET as Handler, "activity", {
      token: secret,
      query: { limit: "1" },
    });
    expect(first.json.items).toHaveLength(1);
    expect(first.json.next_cursor).toEqual(expect.any(String));
    const second = await call(activity.GET as Handler, "activity", {
      token: secret,
      query: { limit: "1", cursor: first.json.next_cursor },
    });
    expect(second.json.items).toHaveLength(1);
    expect(second.json.items[0].id).not.toBe(first.json.items[0].id);
    const event = await call(activityEvent.GET as Handler, "activity/x", {
      token: secret,
      id: first.json.items[0].id,
    });
    expect(event.json.id).toBe(first.json.items[0].id);
  });

  test("a run that does not exist is not found", async () => {
    const w = await createWorkspace();
    const { secret } = await issue(w, w.owner);
    expect(
      await errorCode(
        call(run.GET as Handler, "runs/x", {
          token: secret,
          id: "00000000-0000-4000-8000-000000000000",
        }),
      ),
    ).toBe("NOT_FOUND");
  });

  test("insights answer for a window", async () => {
    const w = await createWorkspace();
    const { secret } = await issue(w, w.owner);
    const { json } = await call(insights.GET as Handler, "insights", {
      token: secret,
      query: { days: "7" },
    });
    expect(json).toMatchObject({
      days: 7,
      decisions: { actions: expect.any(Number), no_rule: expect.any(Number) },
      rules: { active_rules: expect.any(Number) },
    });
    expect(
      await errorCode(
        call(insights.GET as Handler, "insights", {
          token: secret,
          query: { days: "8" },
        }),
      ),
    ).toBe("INVALID_INPUT");
  });
});

/** The agents whose decisions this token sees in Activity. */
const seenAgents = async (token: string) =>
  (
    await call(activity.GET as Handler, "activity", {
      token,
      query: { kind: "decisions" },
    })
  ).json.items.map((item: { agent_key: string }) => item.agent_key);

describe("isolation", () => {
  test("a token sees only its own workspace", async () => {
    const mine = await createWorkspace();
    const theirs = await createWorkspace();
    await createAgent(mine, "mine");
    await createAgent(theirs, "theirs");
    const { secret } = await issue(mine, mine.owner);
    expect(await seenAgents(secret)).toEqual(["mine"]);
  });

  test("a viewer's token sees only their assigned agents", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    await createAgent(w, "assigned", [viewer]);
    await createAgent(w, "hidden");
    const { secret } = await issue(w, viewer);
    expect(await seenAgents(secret)).toEqual(["assigned"]);
  });
});
