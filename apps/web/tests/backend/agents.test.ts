import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  Agent,
  AgentMember,
  AuditEvent,
  Installation,
  InstallationCredential,
} from "@/server/db/entities";
import {
  connectAgent,
  getAgent,
  listAgents,
  pauseAgent,
  resumeAgent,
  revokeCredential,
  rotateCredential,
} from "@/server/modules/agents";
import { getCheckIn } from "@/server/modules/agents/check-in";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  seedAction,
  type Person,
  type TestAgent,
  type TestWorkspace,
  useDatabase,
} from "./world";

const manage = <T>(
  person: HumanPrincipal,
  workspace: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => withWorkspace(person, workspace.id, run);

const read = <T>(
  person: HumanPrincipal,
  workspace: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => readWorkspace(person, workspace.id, run);

const input = (agentKey: string, environmentSlug = "development") => ({
  agentKey,
  description: "",
  environmentSlug,
  adapterKey: "custom-sdk",
});

const connect = (w: TestWorkspace, agentKey: string, environment?: string) =>
  manage(w.owner, w, (context) =>
    connectAgent(context, input(agentKey, environment)),
  );
const pause = (w: TestWorkspace, agentKey: string) =>
  manage(w.owner, w, (context) => pauseAgent(context, agentKey));
const resume = (w: TestWorkspace, agentKey: string) =>
  manage(w.owner, w, (context) => resumeAgent(context, agentKey));
const rotate = (w: TestWorkspace, installationId: string) =>
  manage(w.owner, w, (context) => rotateCredential(context, installationId));
const revoke = (w: TestWorkspace, installationId: string) =>
  manage(w.owner, w, (context) => revokeCredential(context, installationId));
const developmentList = (w: TestWorkspace, person: HumanPrincipal = w.owner) =>
  read(person, w, (context) => listAgents(context, "development"));

const key = () => `agent-${randomUUID().slice(0, 8)}`;

/** What the agent's own runtime would be told about its action now. */
const evaluationOf = async (id: string) =>
  (
    (await admin.query(
      `SELECT initial_evaluation FROM nodrail.action_requests WHERE id = $1`,
      [id],
    )) as { initial_evaluation: string }[]
  )[0]?.initial_evaluation;

useDatabase();

describe("connecting an agent", () => {
  test("creates the agent, its installation and one credential", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    const result = await manage(w.owner, w, (context) =>
      connectAgent(context, {
        ...input(agentKey),
        description: " Customer support ",
      }),
    );
    expect(result.installationName).toBe(`${agentKey}-dev`);
    expect(result.credential.secret).toMatch(/^ndr_[0-9a-f]{12}_[\w-]{43}$/);

    const agent = await admin
      .getRepository(Agent)
      .findOneByOrFail({ workspaceId: w.id, externalKey: agentKey });
    expect(agent.description).toBe("Customer support");
    await expect(
      admin
        .getRepository(AgentMember)
        .existsBy({ agentId: agent.id, userId: w.owner.userId }),
    ).resolves.toBe(true);
  });

  test("stores only a digest of the secret, nowhere the secret itself", async () => {
    const w = await createWorkspace();
    const { credential } = await connect(w, key());
    const secret = credential.secret.split("_").slice(2).join("_");
    const row = await admin
      .getRepository(InstallationCredential)
      .findOneByOrFail({ id: credential.id });
    expect(row.secretDigest).toBe(
      createHash("sha256").update(secret).digest("hex"),
    );
    expect(JSON.stringify(row)).not.toContain(secret);
    const events = await admin
      .getRepository(AuditEvent)
      .findBy({ workspaceId: w.id });
    expect(JSON.stringify(events)).not.toContain(secret);
  });

  test("a known agent can join another environment", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    await connect(w, agentKey);
    const second = await connect(w, agentKey, "production");
    expect(second.installationName).toBe(`${agentKey}-prod`);
    await expect(
      admin.getRepository(Agent).countBy({ workspaceId: w.id }),
    ).resolves.toBe(1);
    await expect(
      admin.getRepository(Installation).countBy({ workspaceId: w.id }),
    ).resolves.toBe(2);
  });

  test("the same environment twice is refused and leaves nothing behind", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    await connect(w, agentKey);
    await expect(connect(w, agentKey)).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
      status: 409,
    });
    await expect(
      admin
        .getRepository(InstallationCredential)
        .countBy({ workspaceId: w.id }),
    ).resolves.toBe(1);
  });

  test("two people connecting the same new agent: one succeeds", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => connect(w, agentKey)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      admin.getRepository(Agent).countBy({ workspaceId: w.id }),
    ).resolves.toBe(1);
  });

  test.each([
    ["uppercase ID", { agentKey: "Support" }],
    ["spaces", { agentKey: "my agent" }],
    ["too long", { agentKey: "a".repeat(59) }],
    ["unknown runtime", { adapterKey: "telepathy" }],
    ["long description", { description: "x".repeat(201) }],
    ["extra fields", { workspaceId: randomUUID() }],
  ])("rejects %s", async (_label, change) => {
    const w = await createWorkspace();
    await expect(
      manage(w.owner, w, (context) =>
        connectAgent(context, { ...input(key()), ...change }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("an unknown environment is not found", async () => {
    const w = await createWorkspace();
    await expect(connect(w, key(), "staging")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("who can manage agents", () => {
  let w: TestWorkspace;
  let agent: TestAgent;

  beforeAll(async () => {
    w = await createWorkspace();
    agent = await createAgent(w, "managed");
  });

  const actions: [string, (context: WorkspaceContext) => Promise<unknown>][] = [
    ["connect", (context) => connectAgent(context, input(key()))],
    ["pause", (context) => pauseAgent(context, "managed")],
    ["resume", (context) => resumeAgent(context, "managed")],
    ["rotate", (context) => rotateCredential(context, agent.installationId)],
    ["revoke", (context) => revokeCredential(context, agent.installationId)],
  ];

  describe.each(["policy_manager", "viewer"] as const)("%s", (role) => {
    test.each(actions)("cannot %s", async (_label, action) => {
      const person = await addMember(w, role);
      await expect(manage(person, w, action)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    });
  });

  test("an admin can", async () => {
    const person = await addMember(w, "admin");
    await expect(
      manage(person, w, (context) => pauseAgent(context, "managed")),
    ).resolves.toMatchObject({ status: "paused" });
    await manage(person, w, (context) => resumeAgent(context, "managed"));
  });

  test("another workspace's agent and installation do not exist", async () => {
    const other = await createWorkspace();
    await expect(
      manage(other.owner, other, (context) => pauseAgent(context, "managed")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      manage(other.owner, other, (context) =>
        rotateCredential(context, agent.installationId),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the agent list", () => {
  test("shows one environment, with live status", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    await connect(w, agentKey);
    const dev = await developmentList(w);
    expect(dev.items.map((item) => item.key)).toEqual([agentKey]);
    expect(dev.items[0]?.installation?.reporting).toBe("never_reported");
    const prod = await read(w.owner, w, (context) =>
      listAgents(context, "production"),
    );
    expect(prod.items).toEqual([]);
    expect(prod.summary).toEqual({ connected: 0, reporting: 0, paused: 0 });
  });

  test("reports by last check-in, and pausing does not change that", async () => {
    const w = await createWorkspace();
    const recent = await createAgent(w, "recent");
    const old = await createAgent(w, "old");
    await createAgent(w, "never");
    const seen = (id: string, minutes: number) =>
      admin.query(
        `UPDATE nodrail.installations
         SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
        [id, minutes],
      );
    await seen(recent.installationId, 2);
    await seen(old.installationId, 31);
    await pause(w, "recent");

    const list = await developmentList(w);
    const reporting = Object.fromEntries(
      list.items.map((item) => [item.key, item.installation?.reporting]),
    );
    expect(reporting).toEqual({
      recent: "reporting",
      old: "stale",
      never: "never_reported",
    });
    expect(list.summary).toEqual({ connected: 3, reporting: 1, paused: 1 });
  });

  test("lists the tools it used", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "counted");
    await admin.transaction((manager) => seedAction(manager, w, agent));
    const list = await developmentList(w);
    expect(list.items[0]).toMatchObject({ tools: ["github"] });
    expect(list.items[0]).not.toHaveProperty("pendingRequests");
  });

  test("pages through every agent exactly once", async () => {
    const w = await createWorkspace();
    await manage(w.owner, w, async (context) => {
      for (let index = 0; index < 53; index += 1)
        await connectAgent(context, input(`bulk-${index}`));
    });
    const first = await developmentList(w);
    expect(first.items).toHaveLength(50);
    expect(first.summary.connected).toBe(53);
    const second = await read(w.owner, w, (context) =>
      listAgents(context, "development", first.nextCursor ?? ""),
    );
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.key)).size,
    ).toBe(53);
  });

  test("a forged cursor is refused", async () => {
    const w = await createWorkspace();
    await expect(
      read(w.owner, w, (context) =>
        listAgents(context, "development", "not-a-cursor"),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("what each person can see", () => {
  let w: TestWorkspace;
  let viewer: Person;

  beforeAll(async () => {
    w = await createWorkspace();
    viewer = await addMember(w, "viewer");
    await createAgent(w, "assigned", [viewer]);
    await createAgent(w, "hidden");
  });

  test("the list and its counts are limited to assigned agents", async () => {
    const list = await developmentList(w, viewer);
    expect(list.items.map((item) => item.key)).toEqual(["assigned"]);
    expect(list.summary.connected).toBe(1);
  });

  test("a hidden agent looks like it does not exist", async () => {
    await expect(
      read(viewer, w, (context) => getAgent(context, "hidden", "development")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("credentials are left out for people who cannot manage them", async () => {
    const detail = await read(viewer, w, (context) =>
      getAgent(context, "assigned", "development"),
    );
    expect(detail.canManage).toBe(false);
    expect(detail.installations[0]).not.toHaveProperty("credentials");
    expect(JSON.stringify(detail)).not.toContain("prefix");
  });

  test("the owner gets credential details, never a secret or digest", async () => {
    const detail = await read(w.owner, w, (context) =>
      getAgent(context, "assigned", "development"),
    );
    const credential = detail.installations[0]?.credentials?.[0];
    expect(credential?.prefix).toBeTruthy();
    expect(JSON.stringify(detail)).not.toMatch(/digest|secret/i);
  });
});

describe("pausing", () => {
  test("moves that agent's access on, and nobody else's", async () => {
    const w = await createWorkspace();
    const paused = await createAgent(w, "paused");
    const other = await createAgent(w, "other");
    const epoch = async (id: string) =>
      (await admin.getRepository(Agent).findOneByOrFail({ id })).accessEpoch;
    const before = await epoch(other.id);
    expect(await pause(w, "paused")).toEqual({ status: "paused" });
    expect(await epoch(paused.id)).toBe(before + 1);
    expect(await epoch(other.id)).toBe(before);
  });

  test("records who paused and when, separately from reporting", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "recorded");
    await admin.query(
      "UPDATE nodrail.installations SET last_seen_at = now() WHERE id = $1",
      [agent.installationId],
    );
    await pause(w, "recorded");
    const detail = await read(w.owner, w, (context) =>
      getAgent(context, "recorded", "development"),
    );
    expect(detail.access.status).toBe("paused");
    expect(detail.access.pausedBy).toBe("Owner");
    expect(detail.access.pausedAt).toBeTruthy();
    expect(detail.installations[0]?.reporting).toBe("reporting");
    await expect(
      admin.getRepository(AuditEvent).countBy({
        workspaceId: w.id,
        eventType: "agent.paused",
        agentId: agent.id,
      }),
    ).resolves.toBe(1);
  });

  test("repeating it changes nothing", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "repeat");
    await pause(w, "repeat");
    const before = await admin
      .getRepository(Agent)
      .findOneByOrFail({ id: agent.id });
    await expect(pause(w, "repeat")).resolves.toEqual({ status: "paused" });
    await expect(
      admin.getRepository(Agent).findOneByOrFail({ id: agent.id }),
    ).resolves.toMatchObject({
      accessEpoch: before.accessEpoch,
      pausedAt: before.pausedAt,
    });
    await expect(
      admin.getRepository(AuditEvent).countBy({
        workspaceId: w.id,
        eventType: "agent.paused",
      }),
    ).resolves.toBe(1);
  });

  test("covers every environment the agent is in", async () => {
    const w = await createWorkspace();
    const agentKey = key();
    await connect(w, agentKey);
    await connect(w, agentKey, "production");
    await pause(w, agentKey);
    for (const environment of ["development", "production"]) {
      const list = await read(w.owner, w, (context) =>
        listAgents(context, environment),
      );
      expect(list.items[0]?.access.status).toBe("paused");
    }
  });
});

describe("resuming", () => {
  test("restores access; its earlier requests stay as decided", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "resumed");
    await pause(w, "resumed");
    await expect(resume(w, "resumed")).resolves.toMatchObject({
      status: "active",
    });
    const row = await admin
      .getRepository(Agent)
      .findOneByOrFail({ id: agent.id });
    expect(row).toMatchObject({
      accessStatus: "active",
      pausedAt: null,
      pausedBy: null,
    });
    expect(await evaluationOf(agent.actionId)).toBe("denied");
  });

  test("an agent that was never paused is left alone", async () => {
    const w = await createWorkspace();
    await createAgent(w, "active");
    await expect(resume(w, "active")).resolves.toEqual({ status: "active" });
  });
});

describe("credentials", () => {
  const live = (installationId: string) =>
    admin.query(
      `SELECT id FROM nodrail.installation_credentials
       WHERE installation_id = $1 AND revoked_at IS NULL`,
      [installationId],
    ) as Promise<{ id: string }[]>;

  test("rotating replaces the secret", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "rotated");
    const issued = await rotate(w, agent.installationId);
    expect(await live(agent.installationId)).toEqual([{ id: issued.id }]);
  });

  test("revoking stops only this installation's credential", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "revoked");
    const other = await createAgent(w, "kept");
    await expect(revoke(w, agent.installationId)).resolves.toEqual({
      revoked: true,
    });
    expect(await live(agent.installationId)).toEqual([]);
    expect(await live(other.installationId)).toHaveLength(1);
  });

  test("revoking twice does nothing the second time", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "twice");
    const again = () => revoke(w, agent.installationId);
    await again();
    await expect(again()).resolves.toEqual({ revoked: false });
  });

  test("a revoked installation can be given a new credential", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "reissued");
    await revoke(w, agent.installationId);
    const issued = await rotate(w, agent.installationId);
    expect(await live(agent.installationId)).toEqual([{ id: issued.id }]);
  });

  test("concurrent rotations leave exactly one live credential", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "racing");
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => rotate(w, agent.installationId)),
    );
    const rows = await live(agent.installationId);
    expect(rows).toHaveLength(1);
    expect(results.map((result) => result.id)).toContain(rows[0]?.id);
  });

  test("the database refuses a second live credential", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "single");
    await expect(
      admin.getRepository(InstallationCredential).insert({
        workspaceId: w.id,
        installationId: agent.installationId,
        publicPrefix: randomUUID().slice(0, 12),
        secretDigest: "d",
        scopes: [],
        createdBy: w.owner.userId,
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("a new agent's check-in", () => {
  test("follows its first check-in and the checks its decisions show", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "fresh");
    const checkIn = () =>
      read(w.owner, w, (context) =>
        getCheckIn(context, "development", "fresh"),
      );
    // The world's agent already has a rule's allow.
    expect(await checkIn()).toEqual({
      lastSeenAt: null,
      checks: { allowed: true, blocked: false, denied: false },
    });

    await admin.query(
      `UPDATE nodrail.installations SET last_seen_at = now() WHERE id = $1`,
      [agent.installationId],
    );
    const { actionId } = await admin.transaction((manager) =>
      seedAction(manager, w, agent),
    );
    for (const code of ["denied_no_rule", "denied_by_rule"])
      await admin.getRepository(AuditEvent).insert({
        workspaceId: w.id,
        eventType: "authorization.decided",
        actorKind: "runtime",
        decisionCode: code,
        agentId: agent.id,
        actionRequestId: actionId,
        environmentId: w.environmentId,
      });
    expect(await checkIn()).toEqual({
      lastSeenAt: expect.any(String),
      checks: { allowed: true, blocked: true, denied: true },
    });
  });

  test("is NOT_FOUND for an agent someone may not see", async () => {
    const w = await createWorkspace();
    await createAgent(w, "hidden");
    const viewer = await addMember(w, "viewer");
    await expect(
      read(viewer, w, (context) =>
        getCheckIn(context, "development", "hidden"),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
