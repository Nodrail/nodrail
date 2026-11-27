import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readHostCredential } from "@nodrail/policy-engine/command-line";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as live } from "@/app/api/v1/rules/live/route";
import { POST as preview } from "@/app/api/v1/rules/preview/route";
import { GET as intended } from "@/app/api/v1/workspace-revisions/route";
import { GET as access } from "@/app/api/v1/runtime/access/route";
import { POST as inventory } from "@/app/api/v1/runtime/inventory/route";
import { POST as disconnect } from "@/app/api/v1/runtime/disconnect/route";
import { GET as policy } from "@/app/api/v1/runtime/policy/route";
import { POST as reserve } from "@/app/api/v1/runtime/budgets/reserve/route";
import { POST as start } from "@/app/api/v1/runtime/budgets/start/route";
import { withWorkspace } from "@/server/db/context";
import { listAgents, pauseAgent, resumeAgent } from "@/server/modules/agents";
import { createApiToken } from "@/server/modules/api-tokens";
import { runHook as runPlugin } from "../../../../packages/client/src/hooks";
import { createWorkspace, useDatabase } from "./world";

useDatabase();

// Loading the CLI fixture at runtime keeps Next's ambient types out of the CLI.
type RunResult = { code: number; out: string; err: string };
type CliFixture = {
  RESOURCES: Record<string, string>;
  locked: (
    files: Record<string, string>,
    bin: undefined,
    send: typeof fetch,
  ) => Promise<{
    cwd: string;
    home: string;
    env: Record<string, string>;
    read(path: string): string;
    write(path: string, content: string): void;
    run(...args: string[]): Promise<RunResult>;
    runWith(
      input: { stdin: string; self: string[] },
      ...args: string[]
    ): Promise<RunResult>;
  }>;
};
const [loadCli] = Object.values(
  import.meta.glob<CliFixture>(
    "../../../../packages/cli/tests/support/setup-project.ts",
  ),
);

const [loadApplied] = Object.values(
  import.meta.glob<{
    appliedEnrollments: (place: {
      root: string;
      home: string;
    }) => { credential?: string }[];
  }>("../../../../packages/cli/src/setup/applied-enrollment.ts"),
);

const origin = "https://enrollment.test";
const rules = `- required_engine_version: 5
- rule: Entry can write
  agent: lead
  tool: files
  operation: file.write
  resource: { kind: file, match: any }
  effect: allow
- rule: Publisher can write
  agent: publisher
  tool: files
  operation: file.write
  resource: { kind: file, match: any }
  effect: allow
- budget: Shared writes
  id: writes
  count: { tool: files, operation: file.write }
  limit: 10
  per: day
  timezone: UTC
  across: environment
`;

type Route = typeof access;
const enrollment = import.meta.glob<{ POST: Route }>(
  "../../src/app/api/v1/projects/{apply,enrollment,enrollment/reconcile}/route.ts",
);

function localApi() {
  const routes: Record<string, Route> = {
    me,
    "rules/live": live,
    "rules/preview": preview,
    "workspace-revisions": intended,
    "runtime/access": access,
    "runtime/inventory": inventory,
    "runtime/disconnect": disconnect,
    "runtime/policy": policy,
    "runtime/budgets/reserve": reserve,
    "runtime/budgets/start": start,
  };
  const requests: { endpoint: string; response: Response }[] = [];
  const network = {
    policyOffline: false,
    offline: false,
    loseReplyFor: "",
  };
  const send: typeof fetch = async (input, init) => {
    if (network.offline) throw new Error("Network unavailable");
    const url = new URL(input instanceof Request ? input.url : input);
    expect(url.origin).toBe(origin);
    const endpoint = url.pathname.slice("/api/v1/".length);
    if (network.policyOffline && endpoint === "runtime/policy")
      throw new Error("Policy fetch unavailable");
    const route =
      routes[endpoint] ??
      (await enrollment[`../../src/app/api/v1/${endpoint}/route.ts`]?.())?.POST;
    if (!route)
      throw new Error(
        `Missing API route: ${endpoint}. Integrate the ENROLL lane first.`,
      );
    const response = await route(
      new NextRequest(url, {
        method: init?.method,
        body: init?.body,
        headers: init?.headers,
      }),
      {
        params: Promise.resolve({}),
      },
    );
    requests.push({ endpoint, response: response.clone() });
    if (endpoint === network.loseReplyFor)
      throw new Error("The server reply was lost");
    return response;
  };
  return { send, requests, network };
}

async function connectedProject(yaml: string) {
  const { locked, RESOURCES } = await loadCli!();
  const w = await createWorkspace();
  const { secret } = await withWorkspace(w.owner, w.id, (context) =>
    createApiToken(context, {
      name: "Apply test",
      scopes: ["read", "rules:write"],
      expiresInDays: 30,
    }),
  );
  const api = localApi();
  const projectId = randomUUID();
  const binding = {
    origin,
    workspace: `w-${w.id}`,
    environment: "development",
    projectId,
  };
  const p = await locked(
    {
      ...RESOURCES,
      "policies/base.yaml": yaml,
      "nodrail.yaml": `${RESOURCES["nodrail.yaml"]}id: ${projectId}
connect: { decide: cloud, url: ${origin}, workspace: ${binding.workspace}, environment: development }
`,
    },
    undefined,
    api.send,
  );
  p.env.NODRAIL_TOKEN = secret;
  p.env.NODRAIL_URL = origin;
  return { p, w, binding, ...api };
}

const checkCredential = (send: typeof fetch, token: string) =>
  send(`${origin}/api/v1/runtime/access`, {
    headers: { authorization: `Bearer ${token}` },
  });

async function destroyAndCheck(
  p: Awaited<ReturnType<typeof connectedProject>>["p"],
) {
  const destroyed = await p.run("destroy", "--yes", "--json");
  expect(destroyed.code, destroyed.err).toBe(0);
  expect(JSON.parse(destroyed.out).credential_revoked).toBe(true);
}

test("real apply enrolls the machine and one installed hook checks each admitted caller", async () => {
  const { p, w, binding, send, requests, network } =
    await connectedProject(rules);
  try {
    p.env.CLAUDE_PROJECT_DIR = p.cwd;
    vi.stubEnv(process.platform === "win32" ? "USERPROFILE" : "HOME", p.home);
    p.write(
      ".claude/settings.json",
      JSON.stringify({ enabledPlugins: { "nodrail@nodrail": true } }),
    );
    const applied = await p.run("apply", "--yes");
    expect(applied.code, applied.err || applied.out).toBe(0);
    expect(applied.err).toBe("");
    expect(
      requests.find(({ endpoint }) => endpoint === "runtime/inventory")
        ?.response.status,
    ).toBe(200);
    const enrolled = requests.find(
      ({ endpoint }) => endpoint === "projects/apply",
    );
    const enrollmentResult = await enrolled?.response.json();
    expect(enrollmentResult).toMatchObject({
      enrollment: {
        installation_id: expect.any(String),
        credential: null,
        credential_generation: expect.stringMatching(/^[a-f0-9]{12}$/),
      },
    });

    const saved = await readHostCredential(p.home, binding);
    expect(saved).not.toBeNull();
    const token = saved!.credential;
    const settings = JSON.parse(p.read(".claude/settings.json"));
    expect(settings.enabledPlugins["nodrail@nodrail"]).toBe(true);
    const command = settings.hooks.PreToolUse[0].hooks[0].command as string;
    const args = [...command.matchAll(/"([^"]+)"|(\S+)/g)]
      .map((match) =>
        (match[1] ?? match[2]!).replace("$CLAUDE_PROJECT_DIR", p.cwd),
      )
      .slice(command.startsWith("nodrail ") ? 1 : 2);

    const pluginEnv = {
      ...p.env,
      NODRAIL_CREDENTIAL: "standalone-test-credential",
    };
    const sessionStart = await runPlugin(
      JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "session",
        source: "startup",
        cwd: p.cwd,
      }),
      pluginEnv,
      { fetch: send },
    );
    expect(sessionStart.stdout).toBe("");

    for (const [metadata, expected] of [
      [{}, "lead"],
      [{ agent_id: "child", agent_type: "publisher" }, "publisher"],
      [{ agent_type: "undeclared" }, /^host-/],
    ] as const) {
      requests.length = 0;
      const stdin = JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "session",
        tool_use_id: randomUUID(),
        cwd: p.cwd,
        tool_name: "Write",
        tool_input: { file_path: join(p.cwd, "new.md"), content: "test" },
        ...metadata,
      });
      const plugin = await runPlugin(stdin, pluginEnv, { fetch: send });
      expect(plugin).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect(requests).toHaveLength(0);
      const host = await p.runWith({ stdin, self: ["--eval", ""] }, ...args);
      const checked = requests.find(
        ({ endpoint }) => endpoint === "runtime/access",
      );
      expect(await checked?.response.json()).toMatchObject({
        project_id: binding.projectId,
        agent:
          typeof expected === "string"
            ? expected
            : expect.stringMatching(expected),
      });
      if (typeof expected === "string") {
        expect(host.out).toBe("");
        expect(
          requests.filter(
            ({ endpoint }) => endpoint === "runtime/budgets/reserve",
          ),
        ).toHaveLength(1);
        expect(
          requests.filter(
            ({ endpoint }) => endpoint === "runtime/budgets/start",
          ),
        ).toHaveLength(1);
      } else {
        expect(host.out).toContain('"permissionDecision":"deny"');
      }
    }
    const status = async () =>
      JSON.parse((await p.run("status", "--json")).out).policy.remote;
    expect(await status()).toMatchObject({ state: "live" });
    const runCachedHook = (metadata: Record<string, string> = {}) =>
      p.runWith(
        {
          stdin: JSON.stringify({
            hook_event_name: "PreToolUse",
            session_id: "session",
            ...metadata,
            tool_use_id: randomUUID(),
            cwd: p.cwd,
            tool_name: "Write",
            tool_input: {
              file_path: join(p.cwd, "offline.md"),
              content: "test",
            },
          }),
          self: ["--eval", ""],
        },
        ...args,
      );
    const machineAgents = () =>
      withWorkspace(w.owner, w.id, (context) =>
        listAgents(context, "development"),
      );
    const machine = (await machineAgents()).items.find(({ key }) =>
      key.startsWith("host-"),
    )!;
    const call = {
      agent: "publisher",
      policy_digest: JSON.parse(p.read(".nodrail/connect.json"))
        .policy_digest as string,
      call_fingerprint: randomUUID(),
    };
    const budget = (endpoint: "reserve" | "start", body: unknown) =>
      send(`${origin}/api/v1/runtime/budgets/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const reserveBody = {
      ...call,
      calls: [{ tool: "files", operation: "file.write" }],
    };
    expect(await (await budget("reserve", reserveBody)).json()).toMatchObject({
      expires_at: expect.any(String),
    });
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "publisher"),
    );
    expect(
      (await runCachedHook({ agent_id: "unnamed-delegate" })).out,
    ).toContain("Access is paused for publisher");
    expect((await runCachedHook()).out).toBe("");
    await withWorkspace(w.owner, w.id, (context) =>
      resumeAgent(context, "publisher"),
    );
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, machine.key),
    );
    expect(
      await (
        await budget("reserve", {
          ...reserveBody,
          call_fingerprint: randomUUID(),
        })
      ).json(),
    ).toMatchObject({
      expires_at: null,
      reason: expect.stringContaining("paused"),
    });
    expect(
      await (await budget("start", { ...call, claim_id: randomUUID() })).json(),
    ).toMatchObject({ claim_id: null });
    expect((await runCachedHook()).out).toContain("is paused");
    await withWorkspace(w.owner, w.id, (context) =>
      resumeAgent(context, machine.key),
    );
    network.policyOffline = true;
    expect((await runCachedHook()).out).toBe("");
    expect(await status()).toMatchObject({ state: "cached" });
    network.offline = true;
    expect((await runCachedHook()).out).toContain(
      "fresh agent access status is unavailable",
    );
    expect(await status()).toMatchObject({ state: "cached" });
    network.offline = false;
    network.policyOffline = false;
    network.loseReplyFor = "runtime/disconnect";
    const lost = await p.run("destroy", "--yes", "--json");
    expect(lost.code).toBe(1);
    expect(lost.err).toContain("disconnect incomplete");
    network.loseReplyFor = "";
    await destroyAndCheck(p);
    const response = await checkCredential(send, token);
    expect(response.status).toBe(401);
    const disconnected = (await machineAgents()).items.find(
      ({ key }) => key === machine.key,
    );
    expect(disconnected?.installation?.disconnected).toBe(true);
    expect(
      await withWorkspace(w.owner, w.id, async ({ manager }) =>
        manager.query(
          "SELECT count(*)::int AS events FROM nodrail.audit_events WHERE workspace_id = $1 AND decision_code = 'credential_revoked'",
          [w.id],
        ),
      ),
    ).toEqual([{ events: 1 }]);
    expect(
      await withWorkspace(w.owner, w.id, (context) =>
        context.manager.query(
          "SELECT count(*)::int AS versions FROM nodrail.policy_versions WHERE workspace_id = $1 AND managed_project_id = $2",
          [w.id, binding.projectId],
        ),
      ),
    ).toEqual([{ versions: 1 }]);
  } finally {
    vi.unstubAllEnvs();
    for (const file of [p.cwd, p.home, p.env.PATH!])
      rmSync(file, { recursive: true, force: true });
  }
});

test("destroy revokes an enrollment whose first apply response was lost", async () => {
  const { p, binding, send, requests, network } = await connectedProject(rules);
  try {
    const folder = join(p.home, ".nodrail", "applied");
    mkdirSync(folder, { recursive: true, mode: 0o755 });
    network.loseReplyFor = "projects/apply";
    expect((await p.run("apply", "--yes")).code).toBe(1);
    expect(
      requests.find(({ endpoint }) => endpoint === "projects/apply")?.response
        .status,
    ).toBe(200);
    expect(await readHostCredential(p.home, binding)).toBeNull();
    expect(() => p.read(".nodrail/setup-state.json")).toThrow();
    const file = join(folder, readdirSync(folder)[0]!);
    if (process.platform !== "win32") {
      expect(statSync(folder).mode & 0o777).toBe(0o700);
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    const { appliedEnrollments } = await loadApplied!();
    const [intent] = appliedEnrollments({ root: p.cwd, home: p.home });
    const credential = intent?.credential;
    if (!credential) throw new Error("Missing enrollment intent");
    expect((await checkCredential(send, credential)).status).not.toBe(401);
    await destroyAndCheck(p);
    expect((await checkCredential(send, credential)).status).toBe(401);
    expect(readdirSync(folder)).toEqual([]);
  } finally {
    for (const file of [p.cwd, p.home, p.env.PATH!])
      rmSync(file, { recursive: true, force: true });
  }
});
