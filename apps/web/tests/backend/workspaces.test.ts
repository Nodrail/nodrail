import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { withWorkspace } from "@/server/db/context";
import {
  ActivePolicy,
  AuditEvent,
  Environment,
  HumanSession,
  PolicyRule,
  PolicyVersion,
  Workspace,
  WorkspaceMembership,
} from "@/server/db/entities";
import {
  createWorkspace,
  getWorkspaceView,
  listMyWorkspaces,
} from "@/server/modules/workspaces";
import {
  isReservedWorkspaceSlug,
  reservedWorkspaceSlugs,
} from "@nodrail/web-shared/routes";
import { provisionWorkspace } from "@/server/db/provisioning";
import { In } from "typeorm";
import { addMember, admin, createPerson, useDatabase } from "./world";

const unique = () => `Team ${randomUUID().slice(0, 8)}`;

useDatabase();

async function ownedWorkspace() {
  const person = await createPerson("Founder");
  const name = unique();
  const { slug } = await createWorkspace(person, { name });
  const row = await admin.getRepository(Workspace).findOneByOrFail({ slug });
  return { person, name, slug, id: row.id };
}

describe("creating a workspace", () => {
  test("makes the creator its owner and admin", async () => {
    const { person, id } = await ownedWorkspace();
    const membership = await admin
      .getRepository(WorkspaceMembership)
      .findOneByOrFail({ workspaceId: id, userId: person.userId });
    expect(membership).toMatchObject({
      role: "admin",
      isOwner: true,
      status: "active",
    });
  });

  test("starts both environments with an empty live policy", async () => {
    const { id } = await ownedWorkspace();
    const environments = await admin
      .getRepository(Environment)
      .findBy({ workspaceId: id });
    expect(environments.map((item) => item.slug).sort()).toEqual([
      "development",
      "production",
    ]);
    for (const environment of environments) {
      const active = await admin
        .getRepository(ActivePolicy)
        .findOneByOrFail({ workspaceId: id, environmentId: environment.id });
      const version = await admin
        .getRepository(PolicyVersion)
        .findOneByOrFail({ id: active.policyVersionId });
      expect(version.revision).toBe(1);
      await expect(
        admin
          .getRepository(PolicyRule)
          .countBy({ workspaceId: id, policyVersionId: version.id }),
      ).resolves.toBe(0);
    }
  });

  test("defaults to Development and records who created it", async () => {
    const { person, id } = await ownedWorkspace();
    const workspace = await admin
      .getRepository(Workspace)
      .findOneByOrFail({ id });
    const development = await admin
      .getRepository(Environment)
      .findOneByOrFail({ workspaceId: id, slug: "development" });
    expect(workspace.defaultEnvironmentId).toBe(development.id);
    const [event] = await admin
      .getRepository(AuditEvent)
      .findBy({ workspaceId: id, eventType: "workspace.created" });
    expect(event?.actorUserId).toBe(person.userId);
  });

  test("gives taken names a different address", async () => {
    const name = unique();
    const one = await createPerson("One");
    const two = await createPerson("Two");
    const first = await createWorkspace(one, { name });
    const second = await createWorkspace(two, { name });
    expect(second.slug).not.toBe(first.slug);
    expect(second.slug.startsWith(first.slug)).toBe(true);
  });

  test.each(["Login", "Billing", "Docs", "API", "New", "Settings", "App"])(
    "never takes a slug reserved for a route: %s",
    async (name) => {
      const person = await createPerson("Founder");
      const { slug } = await createWorkspace(person, { name });
      const base = name.toLowerCase();
      expect(isReservedWorkspaceSlug(base)).toBe(true);
      expect(slug).toMatch(new RegExp(`^${base}-[a-f0-9]{6}$`));
    },
  );

  test("no reserved slug can be stored, whoever provisions it", async () => {
    const person = await createPerson("Founder");
    for (const slug of reservedWorkspaceSlugs) {
      await expect(
        admin.transaction((manager) =>
          provisionWorkspace(manager, {
            id: randomUUID(),
            name: slug,
            slug,
            ownerUserId: person.userId,
          }),
        ),
      ).rejects.toThrow(`"${slug}" is reserved`);
    }
    const stored = await admin
      .getRepository(Workspace)
      .countBy({ slug: In([...reservedWorkspaceSlugs]) });
    expect(stored).toBe(0);
  });

  test("builds a safe address from any name", async () => {
    const person = await createPerson("Founder");
    const accented = await createWorkspace(person, {
      name: `Café & Co. ${randomUUID().slice(0, 4)}`,
    });
    expect(accented.slug).toMatch(/^cafe-co-[a-z0-9]+$/);
    const symbols = await createWorkspace(person, { name: "!!!" });
    expect(symbols.slug).toMatch(/^workspace/);
  });

  test.each([[""], ["   "], ["x".repeat(121)]])(
    "rejects the name %j",
    async (name) => {
      const person = await createPerson("Founder");
      await expect(createWorkspace(person, { name })).rejects.toMatchObject({
        code: "INVALID_INPUT",
        status: 422,
      });
    },
  );

  test("ignores an attempt to choose the owner", async () => {
    const person = await createPerson("Founder");
    await expect(
      createWorkspace(person, { name: unique(), owner: randomUUID() }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  test("needs an open session", async () => {
    const person = await createPerson("Founder");
    await admin
      .getRepository(HumanSession)
      .update(person.sessionId, { revokedAt: new Date() });
    await expect(
      createWorkspace(person, { name: unique() }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("listing and opening workspaces", () => {
  test("people list only their own", async () => {
    const mine = await ownedWorkspace();
    await ownedWorkspace();
    const list = await listMyWorkspaces(mine.person);
    expect(list.map((workspace) => workspace.id)).toEqual([mine.id]);
  });

  test("a revoked membership disappears from the list", async () => {
    const { id, person } = await ownedWorkspace();
    const member = await createPerson("Member");
    await admin.getRepository(WorkspaceMembership).insert({
      workspaceId: id,
      userId: member.userId,
      role: "viewer",
    });
    await expect(listMyWorkspaces(member)).resolves.toHaveLength(1);
    await withWorkspace(person, id, ({ manager }) =>
      manager
        .getRepository(WorkspaceMembership)
        .update(
          { workspaceId: id, userId: member.userId },
          { status: "revoked", revokedAt: new Date() },
        ),
    );
    await expect(listMyWorkspaces(member)).resolves.toEqual([]);
  });

  test("the shell view reflects role and capabilities", async () => {
    const { person, slug, name } = await ownedWorkspace();
    const view = await getWorkspaceView(person, slug);
    expect(view).toMatchObject({ name, slug, role: "admin", isOwner: true });
    expect(view.capabilities).toContain("ownership:manage");
    expect(view.environments.map((item) => item.slug)).toEqual([
      "development",
      "production",
    ]);
    expect(view.defaultEnvironmentId).toBe(view.environments[0]?.id);
    expect(view.person.name).toBe("Founder");
  });

  test("a viewer gets a viewer's capabilities", async () => {
    const { id, slug } = await ownedWorkspace();
    const environment = await admin
      .getRepository(Environment)
      .findOneByOrFail({ workspaceId: id, slug: "development" });
    const viewer = await addMember(
      {
        id,
        owner: await createPerson("unused"),
        environmentId: environment.id,
        versionId: "",
      },
      "viewer",
    );
    const view = await getWorkspaceView(viewer, slug);
    expect(view.role).toBe("viewer");
    expect(view.isOwner).toBe(false);
    expect(view.capabilities).toEqual(["workspace:read"]);
  });

  test("a stranger and a missing address look the same", async () => {
    const { slug } = await ownedWorkspace();
    const stranger = await createPerson("Stranger");
    await expect(getWorkspaceView(stranger, slug)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      getWorkspaceView(stranger, "does-not-exist"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
