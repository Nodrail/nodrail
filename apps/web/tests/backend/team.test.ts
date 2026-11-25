import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { Role } from "@/contracts/v1/access";
import {
  readWorkspace,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  AgentMember,
  WorkspaceInvite,
  WorkspaceMembership,
} from "@/server/db/entities";
import { listActivity } from "@/server/modules/activity";
import { listAgents } from "@/server/modules/agents";
import { createRule } from "@/server/modules/policies";
import {
  acceptInvite,
  createInvite,
  revokeInvite,
  viewInvite,
} from "@/server/modules/team/invites";
import {
  assignAgent,
  changeMemberRole,
  getAgentPeople,
  getTeam,
  removeMember,
  transferOwnership,
  unassignAgent,
} from "@/server/modules/team/members";
import {
  getNotificationPreferences,
  getWorkspaceView,
  saveNotificationPreferences,
  updateWorkspaceSettings,
} from "@/server/modules/workspaces";
import {
  addMember,
  admin,
  createAgent,
  createPerson,
  createWorkspace,
  ruleBody,
  useDatabase,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();

const ENV = "development";

const act = <T>(
  person: Person,
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => withWorkspace(person, w.id, run);

const read = <T>(
  person: Person,
  w: TestWorkspace,
  run: (context: WorkspaceContext) => Promise<T>,
) => readWorkspace(person, w.id, run);

const invite = async (
  w: TestWorkspace,
  email: string,
  role = "viewer",
  by: Person = w.owner,
) =>
  (await act(by, w, (context) => createInvite(context, { email, role }))).token;

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

const membership = (w: TestWorkspace, person: Person) =>
  admin
    .getRepository(WorkspaceMembership)
    .findOneByOrFail({ workspaceId: w.id, userId: person.userId });

const roleOf = async (w: TestWorkspace, person: Person) =>
  (await membership(w, person)).role;

const setRole = (actor: Person, w: TestWorkspace, target: Person, role: Role) =>
  act(actor, w, (context) =>
    changeMemberRole(context, { userId: target.userId, role }),
  );

const remove = (actor: Person, w: TestWorkspace, target: Person) =>
  act(actor, w, (context) => removeMember(context, target.userId));

const owners = async (w: TestWorkspace) =>
  admin
    .getRepository(WorkspaceMembership)
    .countBy({ workspaceId: w.id, isOwner: true });

const expireInvite = (token: string) =>
  admin.query(
    `UPDATE nodrail.workspace_invites
     SET created_at = now() - interval '9 days',
         expires_at = now() - interval '2 days'
     WHERE token_digest = $1`,
    [createHash("sha256").update(token).digest("hex")],
  );

const seesAgents = async (person: Person, w: TestWorkspace) =>
  (await read(person, w, (context) => listAgents(context, ENV))).items.map(
    (item) => item.key,
  );

async function invited(role = "viewer") {
  const w = await createWorkspace();
  const person = await createPerson("Invitee");
  const token = await invite(w, person.email, role);
  return { w, person, token };
}

describe("invites", () => {
  test("joining grants exactly the invited role", async () => {
    const { w, person, token } = await invited("viewer");
    await rejects(
      read(person, w, (context) => getTeam(context)),
      "NOT_FOUND",
    );
    await expect(viewInvite(person, token)).resolves.toMatchObject({
      status: "open",
      workspace: "Test",
      role: "viewer",
      invitedBy: "Owner",
    });
    const { slug } = await acceptInvite(person, token);
    expect(slug).toMatch(/^w-/);
    expect(await membership(w, person)).toMatchObject({
      role: "viewer",
      status: "active",
      isOwner: false,
    });
  });

  test("the token is never stored", async () => {
    const { w, token } = await invited();
    const [row] = await admin
      .getRepository(WorkspaceInvite)
      .findBy({ workspaceId: w.id });
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row?.tokenDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the address is normalised", async () => {
    const w = await createWorkspace();
    const person = await createPerson("Invitee");
    const token = await invite(w, `  ${person.email.toUpperCase()} `);
    await expect(acceptInvite(person, token)).resolves.toBeDefined();
  });

  test.each(["policy_manager", "viewer"] as const)(
    "a %s cannot invite",
    async (role) => {
      const w = await createWorkspace();
      const person = await addMember(w, role);
      await rejects(invite(w, "a@example.test", "viewer", person), "FORBIDDEN");
    },
  );

  test("an admin can invite but never grant admin", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "admin");
    await expect(
      invite(w, "a@example.test", "viewer", person),
    ).resolves.toMatch(/^ndi_/);
    await rejects(
      invite(w, "b@example.test", "admin", person),
      "INVALID_INPUT",
    );
    await rejects(invite(w, "c@example.test", "admin"), "INVALID_INPUT");
  });

  test("one open invite per address, and none for a member", async () => {
    const { w, person } = await invited();
    await rejects(invite(w, person.email), "ALREADY_EXISTS");
    const member = await addMember(w, "viewer");
    await rejects(invite(w, member.email), "ALREADY_EXISTS");
  });

  test("works once, and a double click is harmless", async () => {
    const { w, person, token } = await invited();
    await Promise.all([
      acceptInvite(person, token),
      acceptInvite(person, token),
    ]);
    await expect(acceptInvite(person, token)).resolves.toBeDefined();
    expect(await roleOf(w, person)).toBe("viewer");
    await expect(viewInvite(person, token)).resolves.toEqual({
      status: "unavailable",
    });
  });

  test("somebody else's address gets nothing", async () => {
    const { w, token } = await invited();
    const other = await createPerson("Other");
    await expect(viewInvite(other, token)).resolves.toEqual({
      status: "wrong_email",
      workspace: "Test",
    });
    await rejects(acceptInvite(other, token), "FORBIDDEN");
    await rejects(
      read(other, w, (context) => getTeam(context)),
      "NOT_FOUND",
    );
  });

  test("an expired invite is dead and can be replaced", async () => {
    const { w, person, token } = await invited();
    await expireInvite(token);
    await expect(viewInvite(person, token)).resolves.toEqual({
      status: "unavailable",
    });
    await rejects(acceptInvite(person, token), "NOT_FOUND");
    const fresh = await invite(w, person.email);
    await expect(acceptInvite(person, fresh)).resolves.toBeDefined();
  });

  test("a revoked invite is dead", async () => {
    const { w, person, token } = await invited();
    const team = await read(w.owner, w, (context) => getTeam(context));
    await act(w.owner, w, (context) =>
      revokeInvite(context, team.invites?.[0]?.id ?? ""),
    );
    await rejects(acceptInvite(person, token), "NOT_FOUND");
  });

  test("an unknown token looks like a dead one", async () => {
    const person = await createPerson("Anyone");
    await expect(viewInvite(person, "ndi_nope")).resolves.toEqual({
      status: "unavailable",
    });
    await rejects(acceptInvite(person, "ndi_nope"), "NOT_FOUND");
  });

  test("a revoke cannot reach another workspace's invite", async () => {
    const { w, person, token } = await invited();
    const team = await read(w.owner, w, (context) => getTeam(context));
    const other = await createWorkspace();
    await rejects(
      act(other.owner, other, (context) =>
        revokeInvite(context, team.invites?.[0]?.id ?? ""),
      ),
      "NOT_FOUND",
    );
    await expect(acceptInvite(person, token)).resolves.toBeDefined();
  });

  test.each([
    [
      "demoted",
      (o: Person, w: TestWorkspace, a: Person) => setRole(o, w, a, "viewer"),
    ],
    ["removed", (o: Person, w: TestWorkspace, a: Person) => remove(o, w, a)],
  ])("an invite ends when its sender is %s", async (_label, end) => {
    const w = await createWorkspace();
    const sender = await addMember(w, "admin");
    const person = await createPerson("Invitee");
    const token = await invite(w, person.email, "viewer", sender);
    await end(w.owner, w, sender);
    await rejects(acceptInvite(person, token), "NOT_FOUND");
  });

  test("a person removed earlier comes back with only the new role", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "viewer");
    const agent = await createAgent(w, "old", [person]);
    await remove(w.owner, w, person);
    const token = await invite(w, person.email, "viewer");
    await acceptInvite(person, token);
    expect(await membership(w, person)).toMatchObject({
      role: "viewer",
      status: "active",
      revokedAt: null,
    });
    expect(await seesAgents(person, w)).toEqual([]);
    expect(agent.key).toBe("old");
  });

  test("someone already on the team keeps their role", async () => {
    const { w, person, token } = await invited("viewer");
    await admin.getRepository(WorkspaceMembership).insert({
      workspaceId: w.id,
      userId: person.userId,
      role: "policy_manager",
    });
    await expect(viewInvite(person, token)).resolves.toMatchObject({
      status: "already_member",
    });
    await acceptInvite(person, token);
    expect(await roleOf(w, person)).toBe("policy_manager");
  });

  test("accepting racing a revoke ends one way or the other", async () => {
    for (let round = 0; round < 8; round += 1) {
      const { w, person, token } = await invited();
      const team = await read(w.owner, w, (context) => getTeam(context));
      const [accepted] = await Promise.allSettled([
        acceptInvite(person, token),
        act(w.owner, w, (context) =>
          revokeInvite(context, team.invites?.[0]?.id ?? ""),
        ),
      ]);
      const stored = await admin
        .getRepository(WorkspaceInvite)
        .findOneByOrFail({ workspaceId: w.id });
      const joined = await admin
        .getRepository(WorkspaceMembership)
        .existsBy({ workspaceId: w.id, userId: person.userId });
      expect(joined).toBe(accepted.status === "fulfilled");
      expect(stored.status).toBe(joined ? "accepted" : "revoked");
    }
  });

  test("the lookup is reachable only by the application role", async () => {
    const [row]: { app: boolean; reader: boolean }[] = await admin.query(
      `SELECT
         has_function_privilege('nodrail_app',
           'nodrail.workspace_for_invite(text)', 'execute') AS app,
         has_function_privilege('nodrail_member_read',
           'nodrail.workspace_for_invite(text)', 'execute') AS reader`,
    );
    expect(row).toEqual({ app: true, reader: false });
  });
});

describe("who may change whom", () => {
  type Actor = "owner" | "admin" | "policy_manager" | "viewer";

  async function cast(actorKind: Actor, target: Role) {
    const w = await createWorkspace();
    const actor =
      actorKind === "owner" ? w.owner : await addMember(w, actorKind);
    return { w, actor, person: await addMember(w, target) };
  }

  test.each<[Actor, Role, Role, boolean]>([
    ["owner", "viewer", "policy_manager", true],
    ["owner", "viewer", "admin", true],
    ["owner", "admin", "viewer", true],
    ["admin", "viewer", "policy_manager", true],
    ["admin", "policy_manager", "viewer", true],
    ["admin", "viewer", "admin", false],
    ["admin", "admin", "viewer", false],
    ["policy_manager", "viewer", "policy_manager", false],
    ["viewer", "policy_manager", "viewer", false],
  ])("%s changing a %s to %s: %s", async (actorKind, from, to, allowed) => {
    const { w, actor, person } = await cast(actorKind, from);
    if (allowed) {
      await setRole(actor, w, person, to);
      expect(await roleOf(w, person)).toBe(to);
    } else {
      await rejects(setRole(actor, w, person, to), "FORBIDDEN");
      expect(await roleOf(w, person)).toBe(from);
    }
  });

  test.each<[Actor, Role, boolean]>([
    ["owner", "admin", true],
    ["owner", "viewer", true],
    ["admin", "viewer", true],
    ["admin", "admin", false],
    ["policy_manager", "viewer", false],
    ["viewer", "viewer", false],
  ])("%s removing a %s: %s", async (actorKind, target, allowed) => {
    const { w, actor, person } = await cast(actorKind, target);
    if (allowed) await remove(actor, w, person);
    else await rejects(remove(actor, w, person), "FORBIDDEN");
    expect((await membership(w, person)).status).toBe(
      allowed ? "revoked" : "active",
    );
  });

  test("nobody can change or remove the owner", async () => {
    const w = await createWorkspace();
    const peer = await addMember(w, "admin");
    await rejects(setRole(peer, w, w.owner, "viewer"), "FORBIDDEN");
    await rejects(remove(peer, w, w.owner), "FORBIDDEN");
    await rejects(setRole(w.owner, w, w.owner, "viewer"), "FORBIDDEN");
    await rejects(remove(w.owner, w, w.owner), "FORBIDDEN");
  });

  test("nobody can change themselves", async () => {
    const w = await createWorkspace();
    const peer = await addMember(w, "admin");
    await rejects(setRole(peer, w, peer, "viewer"), "FORBIDDEN");
    await rejects(remove(peer, w, peer), "FORBIDDEN");
  });

  test("a member of another workspace does not exist here", async () => {
    const w = await createWorkspace();
    const other = await createWorkspace();
    const stranger = await addMember(other, "viewer");
    await rejects(setRole(w.owner, w, stranger, "policy_manager"), "NOT_FOUND");
    await rejects(remove(w.owner, w, stranger), "NOT_FOUND");
  });

  test("a new role applies on the very next request", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "policy_manager");
    await setRole(w.owner, w, person, "viewer");
    await rejects(
      act(person, w, (context) => createRule(context, ENV, ruleBody())),
      "FORBIDDEN",
    );
  });

  test("saving the same role records nothing", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "viewer");
    await setRole(w.owner, w, person, "viewer");
    const events = await read(w.owner, w, (context) =>
      listActivity(context, ENV, { view: "changes" }),
    );
    expect(events.items).toEqual([]);
  });
});

describe("removal", () => {
  test("ends access at once, with the session still open", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "admin");
    await remove(w.owner, w, person);
    await rejects(
      read(person, w, (context) => getTeam(context)),
      "NOT_FOUND",
    );
    await rejects(getWorkspaceView(person, "anything"), "NOT_FOUND");
  });

  test("clears assignments and leaves the list", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "viewer");
    await createAgent(w, "a", [person]);
    await remove(w.owner, w, person);
    expect(
      await admin
        .getRepository(AgentMember)
        .countBy({ workspaceId: w.id, userId: person.userId }),
    ).toBe(0);
    const team = await read(w.owner, w, (context) => getTeam(context));
    expect(team.members.map((item) => item.name)).toEqual(["Owner"]);
  });
});

describe("ownership", () => {
  const transfer = (actor: Person, w: TestWorkspace, target: Person) =>
    act(actor, w, (context) => transferOwnership(context, target.userId));

  test("moves to an admin, and the old owner stays one", async () => {
    const w = await createWorkspace();
    const heir = await addMember(w, "admin");
    await transfer(w.owner, w, heir);
    expect(await membership(w, heir)).toMatchObject({ isOwner: true });
    expect(await membership(w, w.owner)).toMatchObject({
      isOwner: false,
      role: "admin",
    });
    expect(await owners(w)).toBe(1);
    await rejects(transfer(w.owner, w, heir), "FORBIDDEN");
    await rejects(setRole(w.owner, w, heir, "viewer"), "FORBIDDEN");
    await setRole(heir, w, w.owner, "viewer");
    expect(await roleOf(w, w.owner)).toBe("viewer");
  });

  test.each(["policy_manager", "viewer"] as const)(
    "cannot go to a %s",
    async (role) => {
      const w = await createWorkspace();
      await rejects(
        transfer(w.owner, w, await addMember(w, role)),
        "INVALID_INPUT",
      );
    },
  );

  test("only the owner can give it away", async () => {
    const w = await createWorkspace();
    const one = await addMember(w, "admin");
    const two = await addMember(w, "admin");
    await rejects(transfer(one, w, two), "FORBIDDEN");
    expect(await owners(w)).toBe(1);
  });

  test("two at once leave exactly one owner", async () => {
    for (let round = 0; round < 6; round += 1) {
      const w = await createWorkspace();
      const one = await addMember(w, "admin");
      const two = await addMember(w, "admin");
      const results = await Promise.allSettled([
        transfer(w.owner, w, one),
        transfer(w.owner, w, two),
      ]);
      expect(await owners(w)).toBe(1);
      expect(
        results.filter((item) => item.status === "fulfilled"),
      ).toHaveLength(1);
    }
  });
});

describe("assigning agents", () => {
  const assign = (actor: Person, w: TestWorkspace, key: string, p: Person) =>
    act(actor, w, (context) => assignAgent(context, key, p.userId));
  const unassign = (actor: Person, w: TestWorkspace, key: string, p: Person) =>
    act(actor, w, (context) => unassignAgent(context, key, p.userId));

  test("grants and takes away sight of the agent", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "viewer");
    await createAgent(w, "a");
    expect(await seesAgents(person, w)).toEqual([]);
    await assign(w.owner, w, "a", person);
    await assign(w.owner, w, "a", person);
    expect(await seesAgents(person, w)).toEqual(["a"]);
    await unassign(w.owner, w, "a", person);
    expect(await seesAgents(person, w)).toEqual([]);
  });

  test("lists only people limited to their assigned agents", async () => {
    const w = await createWorkspace();
    const viewer = await addMember(w, "viewer");
    const other = await addMember(w, "viewer");
    await addMember(w, "policy_manager");
    await addMember(w, "admin");
    await createAgent(w, "a", [viewer]);
    const people = await read(w.owner, w, (context) =>
      getAgentPeople(context, "a"),
    );
    expect(people.assigned.map((item) => item.userId)).toEqual([viewer.userId]);
    expect(people.available.map((item) => item.userId)).toEqual([other.userId]);
  });

  test.each(["admin", "policy_manager"] as const)(
    "a %s already sees everything and is not assignable",
    async (role) => {
      const w = await createWorkspace();
      await createAgent(w, "a");
      await rejects(
        assign(w.owner, w, "a", await addMember(w, role)),
        "INVALID_INPUT",
      );
    },
  );

  test.each(["policy_manager", "viewer"] as const)(
    "a %s cannot assign",
    async (role) => {
      const w = await createWorkspace();
      const person = await addMember(w, role);
      const target = await addMember(w, "viewer");
      await createAgent(w, "a", [person]);
      await rejects(assign(person, w, "a", target), "FORBIDDEN");
      await rejects(unassign(person, w, "a", target), "FORBIDDEN");
      await rejects(
        read(person, w, (context) => getAgentPeople(context, "a")),
        "FORBIDDEN",
      );
    },
  );

  test("an unknown agent is not found", async () => {
    const w = await createWorkspace();
    await rejects(
      assign(w.owner, w, "ghost", await addMember(w, "viewer")),
      "NOT_FOUND",
    );
  });
});

describe("the team list", () => {
  test.each(["policy_manager", "viewer"] as const)(
    "a %s sees people, but not invites or assignments",
    async (role) => {
      const w = await createWorkspace();
      const person = await addMember(w, role);
      await invite(w, "pending@example.test");
      const team = await read(person, w, (context) => getTeam(context));
      expect(team.invites).toBeNull();
      expect(team.assignableRoles).toEqual([]);
      expect(team.members).toHaveLength(2);
      for (const member of team.members)
        expect(member).toMatchObject({
          assignedAgents: null,
          canManage: false,
          canMakeOwner: false,
        });
    },
  );

  test("says what each person may do", async () => {
    const w = await createWorkspace();
    const peer = await addMember(w, "admin");
    const viewer = await addMember(w, "viewer");
    await createAgent(w, "a", [viewer]);
    const flags = async (actor: Person) => {
      const team = await read(actor, w, (context) => getTeam(context));
      return Object.fromEntries(
        team.members.map((item) => [
          item.userId,
          [item.canManage, item.canMakeOwner],
        ]),
      );
    };
    expect(await flags(w.owner)).toEqual({
      [w.owner.userId]: [false, false],
      [peer.userId]: [true, true],
      [viewer.userId]: [true, false],
    });
    expect(await flags(peer)).toEqual({
      [w.owner.userId]: [false, false],
      [peer.userId]: [false, false],
      [viewer.userId]: [true, false],
    });
    const team = await read(peer, w, (context) => getTeam(context));
    expect(
      team.members.find((item) => item.userId === viewer.userId)
        ?.assignedAgents,
    ).toBe(1);
    expect(team.assignableRoles).not.toContain("admin");
  });

  test("shows open invites, including expired ones", async () => {
    const w = await createWorkspace();
    await expireInvite(await invite(w, "late@example.test", "viewer"));
    const team = await read(w.owner, w, (context) => getTeam(context));
    expect(team.invites).toEqual([
      expect.objectContaining({
        email: "late@example.test",
        role: "viewer",
        invitedBy: "Owner",
        expired: true,
      }),
    ]);
  });

  test("team changes are in the history, for those who see it", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "policy_manager");
    await setRole(w.owner, w, person, "viewer");
    const changes = (who: Person) =>
      read(who, w, (context) =>
        listActivity(context, ENV, { view: "changes" }),
      );
    expect((await changes(w.owner)).items[0]).toMatchObject({
      code: "member_role_changed",
      subject: "policy_manager",
      detail: "policy_manager → viewer",
      actor: { name: "Owner" },
    });
    expect((await changes(person)).items).toEqual([]);
  });
});

describe("settings", () => {
  const save = (actor: Person, w: TestWorkspace, body: object) =>
    act(actor, w, (context) => updateWorkspaceSettings(context, body));
  const valid = { name: "Renamed", defaultEnvironment: "production" };

  test("renames without moving the workspace", async () => {
    const w = await createWorkspace();
    const before = await admin.query(
      `SELECT slug FROM nodrail.workspaces WHERE id = $1`,
      [w.id],
    );
    await save(w.owner, w, valid);
    const [row]: { name: string; slug: string; env: string }[] =
      await admin.query(
        `SELECT w.name, w.slug, e.slug AS env FROM nodrail.workspaces w
         JOIN nodrail.environments e ON e.id = w.default_environment_id
         WHERE w.id = $1`,
        [w.id],
      );
    expect(row).toEqual({
      name: "Renamed",
      slug: (before as { slug: string }[])[0]?.slug,
      env: "production",
    });
  });

  test.each(["policy_manager", "viewer"] as const)(
    "a %s cannot change them",
    async (role) => {
      const w = await createWorkspace();
      await rejects(save(await addMember(w, role), w, valid), "FORBIDDEN");
    },
  );

  test.each([
    { name: "", defaultEnvironment: "production" },
    { name: "x".repeat(121), defaultEnvironment: "production" },
    { name: "Fine", defaultEnvironment: "ghost" },
  ])("refuses bad values %#", async (body) => {
    const w = await createWorkspace();
    await rejects(save(w.owner, w, body), "INVALID_INPUT");
  });

  const off = { integrationStale: false, usageAlerts: true };
  const prefs = (person: Person, w: TestWorkspace) =>
    read(person, w, (context) => getNotificationPreferences(context));

  test.each(["policy_manager", "viewer", "admin"] as const)(
    "a %s keeps their own notification choices",
    async (role) => {
      const w = await createWorkspace();
      const person = await addMember(w, role);
      await expect(prefs(person, w)).resolves.toEqual({
        integrationStale: true,
        usageAlerts: true,
      });
      await act(person, w, (context) =>
        saveNotificationPreferences(context, off),
      );
      await act(person, w, (context) =>
        saveNotificationPreferences(context, { ...off, usageAlerts: false }),
      );
      await expect(prefs(person, w)).resolves.toEqual({
        ...off,
        usageAlerts: false,
      });
      await expect(prefs(w.owner, w)).resolves.toMatchObject({
        integrationStale: true,
      });
    },
  );

  test("refuses anything but the two choices", async () => {
    const w = await createWorkspace();
    await rejects(
      act(w.owner, w, (context) =>
        saveNotificationPreferences(context, { ...off, userId: "x" }),
      ),
      "INVALID_INPUT",
    );
  });
});
