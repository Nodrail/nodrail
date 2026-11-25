import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  ActivePolicy,
  Agent,
  AgentMember,
  DecisionPermit,
  Environment,
  Workspace,
  HumanSession,
  Installation,
  ActionRequest,
  User,
  WorkspaceMembership,
} from "@/server/db/entities";
import {
  readWorkspace,
  requireCapability,
  withUser,
  withWorkspace,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  addMember,
  admin,
  appDirect,
  appLogin,
  createAgent,
  createPerson,
  createWorkspace,
  type Person,
  type TestAgent,
  type TestWorkspace,
  useDatabase,
} from "./world";

// Read from the database, so a future table cannot be forgotten here.
let tenantTables: string[] = [];

const agentKeys = async (context: WorkspaceContext) =>
  (await context.manager.getRepository(Agent).find())
    .map((agent) => agent.externalKey)
    .sort();

const count = async (context: WorkspaceContext, table: string) => {
  const [row]: { n: number }[] = await context.manager.query(
    `SELECT count(*)::int AS n FROM nodrail.${table}`,
  );
  return row?.n;
};

useDatabase();

let a: TestWorkspace;
let b: TestWorkspace;
let agentB: TestAgent;

beforeAll(async () => {
  tenantTables = (
    (await admin.query(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema = 'nodrail' AND column_name = 'workspace_id'`,
    )) as { table_name: string }[]
  ).map((row) => row.table_name);
  a = await createWorkspace();
  b = await createWorkspace();
  await createAgent(a, "support");
  agentB = await createAgent(b, "billing");
});

describe("schema", () => {
  test("entities and migrations agree", async () => {
    const log = await admin.driver.createSchemaBuilder().log();
    expect(log.upQueries.map((query) => query.query)).toEqual([]);
  });

  test("the application role cannot bypass the rules", async () => {
    const [role] = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
       FROM pg_roles WHERE rolname = $1`,
      [appLogin],
    );
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
    });
    const expectedUnforced = [
      "external_auth_accounts",
      "human_sessions",
      "installation_credentials",
      "login_accounts",
      "login_links",
      "login_rate_windows",
      "personal_access_tokens",
      "users",
      "workspace_invites",
    ];
    const unforced: { relname: string; relrowsecurity: boolean }[] =
      await admin.query(
        `SELECT relname, relrowsecurity FROM pg_class
       WHERE relnamespace = 'nodrail'::regnamespace AND relkind = 'r'
         AND NOT (relrowsecurity AND relforcerowsecurity)
       ORDER BY relname`,
      );
    expect(unforced.map(({ relname }) => relname)).toEqual(expectedUnforced);
    expect(
      unforced
        .filter((row) => !row.relrowsecurity)
        .map(({ relname }) => relname),
    ).toEqual(["external_auth_accounts"]);
  });
});

describe("who can enter a workspace", () => {
  test("a stranger and a malformed ID get the same not found", async () => {
    await expect(
      withWorkspace(a.owner, b.id, async () => "entered"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      readWorkspace(a.owner, "not-a-uuid", async () => "entered"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a revoked session is refused, even with a valid user", async () => {
    const person = await addMember(a, "viewer");
    await admin
      .getRepository(HumanSession)
      .update({ id: person.sessionId }, { revokedAt: new Date() });
    await expect(
      withWorkspace(person, a.id, async () => "entered"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
  });

  test("a session belonging to someone else is refused", async () => {
    const person = await addMember(a, "viewer");
    await expect(
      withWorkspace(
        { userId: person.userId, sessionId: a.owner.sessionId },
        a.id,
        async () => "entered",
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  test("a suspended person is refused", async () => {
    const person = await addMember(a, "viewer");
    await admin
      .getRepository(User)
      .update({ id: person.userId }, { status: "suspended" });
    await expect(withUser(person, async () => "entered")).rejects.toMatchObject(
      { code: "UNAUTHENTICATED" },
    );
  });

  test("removal takes effect on the next request", async () => {
    const person = await addMember(a, "viewer");
    await expect(
      withWorkspace(person, a.id, async () => "entered"),
    ).resolves.toBe("entered");
    await admin
      .getRepository(WorkspaceMembership)
      .update(
        { workspaceId: a.id, userId: person.userId },
        { status: "revoked", revokedAt: new Date() },
      );
    await expect(
      withWorkspace(person, a.id, async () => "entered"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("capabilities follow the role", async () => {
    const viewer = await addMember(a, "viewer");
    await withWorkspace(viewer, a.id, async (context) => {
      expect(() => requireCapability(context, "policies:write")).toThrow(
        "FORBIDDEN",
      );
    });
    await withWorkspace(a.owner, a.id, async (context) => {
      expect(context.isOwner).toBe(true);
      expect(() =>
        requireCapability(context, "ownership:manage"),
      ).not.toThrow();
    });
  });

  test("before choosing a workspace, people list only their own", async () => {
    const memberships = await withUser(a.owner, ({ manager }) =>
      manager.getRepository(WorkspaceMembership).find(),
    );
    expect(memberships.map((m) => m.workspaceId)).toEqual([a.id]);
  });
});

describe("tenant isolation", () => {
  test("every tenant table holds only this workspace", async () => {
    expect(tenantTables.length).toBeGreaterThan(15);
    await withWorkspace(a.owner, a.id, async ({ manager }) => {
      for (const table of tenantTables) {
        const rows: { workspace_id: string }[] = await manager.query(
          `SELECT DISTINCT workspace_id FROM nodrail.${table}`,
        );
        for (const row of rows) expect(row.workspace_id).toBe(a.id);
      }
    });
  });

  test("every tenant table returns nothing without context", async () => {
    for (const table of tenantTables) {
      const [row] = await appDirect.query(
        `SELECT count(*)::int AS n FROM nodrail.${table}`,
      );
      expect(row.n, table).toBe(0);
    }
  });

  test("a valid ID from another workspace finds nothing", async () => {
    await withWorkspace(a.owner, a.id, async ({ manager }) => {
      expect(
        await manager.getRepository(Agent).findOneBy({ id: agentB.id }),
      ).toBeNull();
    });
  });

  test("writing into another workspace is refused", async () => {
    await expect(
      withWorkspace(a.owner, a.id, ({ manager }) =>
        manager
          .getRepository(Agent)
          .insert({ workspaceId: b.id, externalKey: "intruder" }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  test("context stays put under concurrency and after failures", async () => {
    const reads = Array.from({ length: 40 }, (_, index) => {
      const target = index % 2 ? a : b;
      if (index % 5 === 0)
        return withWorkspace(target.owner, target.id, async () => {
          throw new Error("rolled back");
        }).catch(() => "failed");
      return withWorkspace(target.owner, target.id, async ({ manager }) => {
        const rows: { workspace_id: string }[] = await manager.query(
          "SELECT DISTINCT workspace_id FROM nodrail.agents",
        );
        expect(rows.map((row) => row.workspace_id)).toEqual([target.id]);
        return "ok";
      });
    });
    const results = await Promise.all(reads);
    expect(results.filter((result) => result === "failed")).toHaveLength(8);
    const [leak] = await appDirect.query(
      "SELECT count(*)::int AS n FROM nodrail.agents",
    );
    expect(leak.n).toBe(0);
  });
});

describe("database grants", () => {
  test.each([
    [
      "changing audit history",
      "UPDATE nodrail.audit_events SET decision_code = 'x'",
    ],
    ["deleting audit history", "DELETE FROM nodrail.audit_events"],
    ["emptying audit history", "TRUNCATE nodrail.audit_events"],
    [
      "rewriting a published rule",
      "UPDATE nodrail.policy_rules SET effect = 'allow'",
    ],
    ["deleting a policy version", "DELETE FROM nodrail.policy_versions"],
    [
      "changing a request's parameters",
      "UPDATE nodrail.action_requests SET params_safe = '{}'",
    ],
    [
      "reading login identities",
      "SELECT * FROM nodrail.external_auth_accounts",
    ],
    ["changing the schema", "ALTER TABLE nodrail.agents ADD COLUMN x text"],
    ["creating tables", "CREATE TABLE nodrail.x (id int)"],
  ])("%s is refused", async (_label, sql) => {
    await expect(
      withWorkspace(a.owner, a.id, ({ manager }) => manager.query(sql)),
    ).rejects.toThrow(/permission denied|must be owner/);
  });
});

describe("the database refuses invalid links", () => {
  test("an installation cannot use another workspace's agent", async () => {
    await expect(
      admin.getRepository(Installation).insert({
        workspaceId: a.id,
        agentId: agentB.id,
        environmentId: a.environmentId,
        name: "crossed",
        adapterKey: "test",
      }),
    ).rejects.toThrow(/foreign key/);
  });

  test("a request cannot mix agents inside one workspace", async () => {
    const one = await createAgent(a, "one");
    const two = await createAgent(a, "two");
    await expect(
      admin.getRepository(ActionRequest).insert({
        workspaceId: a.id,
        installationId: one.installationId,
        agentId: two.id,
        environmentId: a.environmentId,
        idempotencyKey: randomUUID(),
        toolKey: "t",
        operationKey: "o",
        resourceKind: "k",
        resourceId: "r",
        permissionFingerprint: "f",
        descriptorDigest: "d",
        actionDigest: "a",
        initialPolicyVersionId: a.versionId,
        accessEpoch: 1,
        initialEvaluation: "denied",
        expiresAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow(/foreign key/);
  });

  test("a request gets only one permit", async () => {
    const agent = await createAgent(a, "single");
    const permit = {
      workspaceId: a.id,
      actionRequestId: agent.actionId,
      policyVersionId: a.versionId,
      credentialId: agent.credentialId,
      expiresAt: new Date(Date.now() + 5000),
      claimNonceDigest: "n",
    };
    await admin.getRepository(DecisionPermit).insert(permit);
    await expect(
      admin.getRepository(DecisionPermit).insert(permit),
    ).rejects.toThrow(/duplicate key/);
  });

  const updateOwner = (values: Partial<WorkspaceMembership>) =>
    withWorkspace(a.owner, a.id, ({ manager }) =>
      manager
        .getRepository(WorkspaceMembership)
        .update({ workspaceId: a.id, userId: a.owner.userId }, values),
    );

  test("the owner cannot stop being an active admin", async () => {
    await expect(updateOwner({ role: "viewer" })).rejects.toThrow(
      /memberships_owner_active_admin/,
    );
    await expect(
      updateOwner({ status: "revoked", revokedAt: new Date() }),
    ).rejects.toThrow(/memberships_owner_active_admin/);
  });

  test("a workspace cannot be left without an owner", async () => {
    await expect(updateOwner({ isOwner: false })).rejects.toThrow(
      /must have an owner/,
    );
  });

  test("a workspace cannot have two owners", async () => {
    const other = await addMember(a, "admin");
    await expect(
      admin
        .getRepository(WorkspaceMembership)
        .update({ workspaceId: a.id, userId: other.userId }, { isOwner: true }),
    ).rejects.toThrow(/duplicate key/);
  });

  test("ownership can be transferred in one transaction", async () => {
    const w = await createWorkspace();
    const next = await addMember(w, "admin");
    await withWorkspace(w.owner, w.id, async ({ manager }) => {
      const members = manager.getRepository(WorkspaceMembership);
      await members.update(
        { workspaceId: w.id, userId: w.owner.userId },
        { isOwner: false },
      );
      await members.update(
        { workspaceId: w.id, userId: next.userId },
        { isOwner: true },
      );
    });
    await expect(
      withWorkspace(next, w.id, async ({ isOwner }) => isOwner),
    ).resolves.toBe(true);
  });

  test("a workspace needs an owner when created", async () => {
    await expect(
      admin.getRepository(Workspace).insert({
        name: "Orphan",
        slug: `o-${randomUUID()}`.slice(0, 40),
      }),
    ).rejects.toThrow(/must have an owner/);
  });

  test("an environment needs an active policy when created", async () => {
    await expect(
      admin.getRepository(Environment).insert({
        workspaceId: a.id,
        slug: "no-policy",
        name: "No policy",
      }),
    ).rejects.toThrow(/must have an active policy/);
  });

  test("the live policy must belong to its environment", async () => {
    const other = await createWorkspace();
    await expect(
      admin.getRepository(ActivePolicy).update(
        { workspaceId: a.id, environmentId: a.environmentId },
        {
          policyVersionId: other.versionId,
        },
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("per-person visibility", () => {
  let w: TestWorkspace;
  let viewer: Person;
  let assigned: Person;
  let manager: Person;
  let adminMember: Person;
  let support: TestAgent;
  let billing: TestAgent;

  beforeAll(async () => {
    w = await createWorkspace();
    viewer = await addMember(w, "viewer");
    assigned = await addMember(w, "viewer");
    manager = await addMember(w, "policy_manager");
    adminMember = await addMember(w, "admin");
    support = await createAgent(w, "support", [viewer]);
    billing = await createAgent(w, "billing", [assigned]);
  });

  const scoped = [
    "agents",
    "installations",
    "installation_credentials",
    "observed_permissions",
    "action_requests",
    "policy_rules",
    "audit_events",
  ];

  test.each(scoped)("viewers see one agent's rows in %s", async (table) => {
    await readWorkspace(viewer, w.id, async (context) => {
      expect(await count(context, table)).toBe(1);
    });
  });

  test("a person sees their own agents, not a colleague's", async () => {
    await readWorkspace(viewer, w.id, async (context) => {
      expect(await agentKeys(context)).toEqual(["support"]);
      expect(
        await context.manager
          .getRepository(Agent)
          .findOneBy({ id: billing.id }),
      ).toBeNull();
    });
    await readWorkspace(assigned, w.id, async (context) => {
      expect(await agentKeys(context)).toEqual(["billing"]);
    });
  });

  test.each([
    ["owner", () => w.owner],
    ["admin", () => adminMember],
    ["policy manager", () => manager],
  ])("the %s sees the whole workspace", async (_label, person) => {
    await readWorkspace(person(), w.id, async (context) => {
      expect(await agentKeys(context)).toEqual(["billing", "support"]);
      for (const table of scoped) expect(await count(context, table)).toBe(2);
    });
  });

  test("workspace-wide rules are visible to everyone", async () => {
    const logicalRuleId = randomUUID();
    await admin.query(
      `INSERT INTO nodrail.policy_rules
         (workspace_id, environment_id, policy_version_id, logical_rule_id, name,
          tool_key, operation_key, effect, resource_scope, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, 'Global', 'github', 'repositories.delete', 'deny',
               '{"kind":"repository","match":"any"}', $5, now())`,
      [w.id, w.environmentId, w.versionId, logicalRuleId, w.owner.userId],
    );
    await readWorkspace(viewer, w.id, async (context) => {
      const rows: { name: string }[] = await context.manager.query(
        "SELECT name FROM nodrail.policy_rules ORDER BY name",
      );
      expect(rows.map((row) => row.name)).toEqual(["Global", "support rule"]);
    });
    await admin.query(
      "DELETE FROM nodrail.policy_rules WHERE logical_rule_id = $1",
      [logicalRuleId],
    );
  });

  test("people always see their own actions", async () => {
    await admin.query(
      `INSERT INTO nodrail.audit_events
         (workspace_id, event_type, actor_kind, actor_user_id, agent_id, decision_code)
       VALUES ($1, 'policy.published', 'human', $2, $3, 'rule_create')`,
      [w.id, viewer.userId, billing.id],
    );
    await readWorkspace(viewer, w.id, async (context) => {
      const rows: { decision_code: string }[] = await context.manager.query(
        "SELECT decision_code FROM nodrail.audit_events ORDER BY decision_code",
      );
      expect(rows.map((row) => row.decision_code)).toEqual([
        "allowed_by_rule",
        "rule_create",
      ]);
    });
  });

  test("screens cannot write", async () => {
    await expect(
      readWorkspace(w.owner, w.id, ({ manager: entities }) =>
        entities.getRepository(AgentMember).insert({
          workspaceId: w.id,
          agentId: billing.id,
          userId: viewer.userId,
        }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  test("security steps still reach every request", async () => {
    await withWorkspace(viewer, w.id, async (context) => {
      expect(await count(context, "action_requests")).toBe(2);
      expect(await agentKeys(context)).toEqual(["billing", "support"]);
    });
  });

  test("assignment and role changes apply on the next read", async () => {
    const person = await addMember(w, "viewer");
    const read = () =>
      readWorkspace(person, w.id, (context) => agentKeys(context));
    expect(await read()).toEqual([]);
    await admin.getRepository(AgentMember).insert({
      workspaceId: w.id,
      agentId: support.id,
      userId: person.userId,
    });
    expect(await read()).toEqual(["support"]);
    await admin
      .getRepository(WorkspaceMembership)
      .update({ workspaceId: w.id, userId: person.userId }, { role: "admin" });
    expect(await read()).toEqual(["billing", "support"]);
  });

  test("an unassigned newcomer sees no agents at all", async () => {
    const person = await createPerson("Newcomer");
    await admin.getRepository(WorkspaceMembership).insert({
      workspaceId: w.id,
      userId: person.userId,
      role: "viewer",
    });
    await readWorkspace(person, w.id, async (context) => {
      expect(await agentKeys(context)).toEqual([]);
      expect(await count(context, "action_requests")).toBe(0);
    });
  });
});
