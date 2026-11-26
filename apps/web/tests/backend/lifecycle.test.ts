import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { applyRetention, EXPIRED_TEXT } from "@/server/maintenance/retention";
import {
  beforeAuthentication,
  readWorkspace,
  withWorkspace,
} from "@/server/db/context";
import {
  ActionRequest,
  AgentMember,
  User,
  WorkspaceMembership,
} from "@/server/db/entities";
import { WorkspaceBilling } from "@/server/db/usage-entities";
import { issueSession, resolveSession } from "@/server/auth/sessions";
import { createVerifiedAccount } from "@/server/auth/store";
import { eraseAccount } from "@/server/modules/account";
import { getTeam } from "@/server/modules/team/members";
import { createInvite, viewInvite } from "@/server/modules/team/invites";
import { changeMemberRole } from "@/server/modules/team/members";
import {
  archiveWorkspace,
  listMyWorkspaces,
} from "@/server/modules/workspaces";
import { exportWorkspace } from "@/server/modules/workspaces/export";
import { dispatch, rig, step, work } from "./runs-world";
import {
  addMember,
  admin,
  appDirect,
  checkIn,
  createAgent,
  createPerson,
  createWorkspace,
  useDatabase,
  useDeployment,
  workspaceWithToken,
  type Person,
  type TestWorkspace,
} from "./world";

useDatabase();
useDeployment("cloud");

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

const archive = (w: TestWorkspace, confirmation: unknown, by = w.owner) =>
  withWorkspace(by, w.id, (context) => archiveWorkspace(context, confirmation));

describe("archiving a workspace", () => {
  test("needs the exact name", async () => {
    const w = await createWorkspace();
    await rejects(archive(w, "wrong"), "INVALID_INPUT");
    await rejects(archive(w, undefined), "INVALID_INPUT");
  });

  test.each(["admin", "policy_manager", "viewer"] as const)(
    "a %s cannot do it",
    async (role) => {
      const w = await createWorkspace();
      await rejects(archive(w, "Test", await addMember(w, role)), "FORBIDDEN");
    },
  );

  test.each(["active", "past_due"])(
    "is refused while a subscription is %s",
    async (status) => {
      const w = await createWorkspace();
      await admin
        .getRepository(WorkspaceBilling)
        .insert({ workspaceId: w.id, plan: "pro", status });
      await rejects(archive(w, "Test"), "BILLING_ACTIVE");
    },
  );

  test("ends access for people and agents, and closes invites", async () => {
    const { w, token } = await workspaceWithToken();
    const member = await addMember(w, "viewer");
    const guest = await createPerson("Guest");
    const { token: invite } = await withWorkspace(w.owner, w.id, (context) =>
      createInvite(context, { email: guest.email, role: "viewer" }),
    );
    await archive(w, "Test");
    await rejects(
      readWorkspace(member, w.id, (context) => getTeam(context)),
      "NOT_FOUND",
    );
    expect(await listMyWorkspaces(w.owner)).toEqual([]);
    await rejects(checkIn(token), "UNAUTHENTICATED");
    await expect(viewInvite(guest, invite)).resolves.toEqual({
      status: "unavailable",
    });
  });
});

describe("deleting an account", () => {
  async function member() {
    const w = await createWorkspace();
    const person = await addMember(w, "policy_manager");
    const agent = await createAgent(w, "bot", [person]);
    return { w, person, agent };
  }

  const stored = (person: Person) =>
    admin.getRepository(User).findOneByOrFail({ id: person.userId });

  test("needs the person's own email", async () => {
    const { person } = await member();
    await rejects(eraseAccount(person, "other@example.test"), "INVALID_INPUT");
    await rejects(eraseAccount(person, undefined), "INVALID_INPUT");
    expect((await stored(person)).status).toBe("active");
  });

  test("an owner must hand over or archive first", async () => {
    const w = await createWorkspace();
    await rejects(eraseAccount(w.owner, w.owner.email), "OWNS_WORKSPACE");
  });

  test("removes identity and access", async () => {
    const { w, person } = await member();
    await eraseAccount(person, person.email.toUpperCase());

    expect(await stored(person)).toMatchObject({
      displayName: "Deleted user",
      verifiedEmail: null,
      status: "suspended",
    });
    await rejects(
      readWorkspace(person, w.id, (context) => getTeam(context)),
      "UNAUTHENTICATED",
    );
    expect(
      await admin
        .getRepository(WorkspaceMembership)
        .findOneByOrFail({ workspaceId: w.id, userId: person.userId }),
    ).toMatchObject({ status: "revoked" });
    expect(
      await admin
        .getRepository(AgentMember)
        .countBy({ workspaceId: w.id, userId: person.userId }),
    ).toBe(0);
  });

  test("leaves no trace of the name or address in stored text", async () => {
    const { w, person } = await member();
    await admin
      .getRepository(User)
      .update({ id: person.userId }, { displayName: "Zelda Fitzgerald" });
    await withWorkspace(w.owner, w.id, (context) =>
      changeMemberRole(context, { userId: person.userId, role: "viewer" }),
    );
    await admin.query(
      `INSERT INTO nodrail.notification_outbox
         (workspace_id, kind, recipient_user_id, recipient_email, dedupe_key, available_at)
       VALUES ($1, 'integration_stale', $2, $3, $4, now() + interval '1 day')`,
      [w.id, person.userId, person.email, randomUUID()],
    );
    await eraseAccount(person, person.email);
    const events: { payload_safe: object }[] = await admin.query(
      `SELECT payload_safe FROM nodrail.audit_events WHERE workspace_id = $1`,
      [w.id],
    );
    expect(JSON.stringify(events)).not.toContain("Zelda");
    const [mail]: { recipient_email: string; state: string }[] =
      await admin.query(
        `SELECT recipient_email, state FROM nodrail.notification_outbox
         WHERE workspace_id = $1`,
        [w.id],
      );
    expect(mail).toEqual({
      recipient_email: "erased@invalid",
      state: "dropped",
    });
  });

  test("cannot touch another workspace, or someone who shares the name", async () => {
    const { w, person } = await member();
    await admin
      .getRepository(User)
      .update({ id: person.userId }, { displayName: "alice" });
    const other = await createWorkspace();
    const namesake = await addMember(other, "viewer");
    await admin
      .getRepository(User)
      .update({ id: namesake.userId }, { displayName: "alice" });
    await withWorkspace(other.owner, other.id, (context) =>
      changeMemberRole(context, {
        userId: namesake.userId,
        role: "policy_manager",
      }),
    );
    const sameTeam = await addMember(w, "viewer");
    await admin
      .getRepository(User)
      .update({ id: sameTeam.userId }, { displayName: "alice" });
    await withWorkspace(w.owner, w.id, (context) =>
      changeMemberRole(context, {
        userId: sameTeam.userId,
        role: "policy_manager",
      }),
    );
    await eraseAccount(person, person.email);
    for (const workspace of [other, w]) {
      const [row]: { subject: string }[] = await admin.query(
        `SELECT payload_safe->>'subject' AS subject FROM nodrail.audit_events
         WHERE workspace_id = $1 AND decision_code = 'member_role_changed'`,
        [workspace.id],
      );
      expect(row?.subject).toBe("alice");
    }
  });

  test("another team's record of inviting this address is theirs", async () => {
    const { person } = await member();
    const elsewhere = await createWorkspace();
    await withWorkspace(elsewhere.owner, elsewhere.id, (context) =>
      createInvite(context, { email: person.email, role: "viewer" }),
    );
    await eraseAccount(person, person.email);
    const [row]: { subject: string }[] = await admin.query(
      `SELECT payload_safe->>'subject' AS subject FROM nodrail.audit_events
       WHERE workspace_id = $1 AND decision_code = 'member_invited'`,
      [elsewhere.id],
    );
    expect(row?.subject).toBe(person.email);
  });

  test("the same email can sign up again as someone new", async () => {
    const email = `${randomUUID()}@example.test`;
    const signUp = () =>
      admin.transaction(async (manager) => {
        const id = await createVerifiedAccount(manager, email, null);
        return issueSession(manager, id);
      });
    const firstSession = await signUp();
    const first = await resolveSession(firstSession.token);
    if (!first) throw new Error("no session");
    await eraseAccount(first, email);
    await expect(resolveSession(firstSession.token)).resolves.toBeNull();
    const second = await resolveSession((await signUp()).token);
    expect(second).not.toBeNull();
    expect(second?.userId).not.toBe(first.userId);
  });

  test("erasing needs a signed-in person", async () => {
    await expect(
      beforeAuthentication((manager) =>
        manager.query("SELECT nodrail.erase_current_user()"),
      ),
    ).rejects.toThrow();
  });
});

describe("exporting a workspace", () => {
  const exported = (person: Person, w: TestWorkspace) =>
    readWorkspace(person, w.id, (context) => exportWorkspace(context));

  test("holds the workspace's data and never a credential", async () => {
    const { w } = await workspaceWithToken();
    const data = await exported(w.owner, w);
    expect(data.agents).toHaveLength(1);
    expect(data.actions).toHaveLength(1);
    const text = JSON.stringify(data);
    for (const secret of ["digest", "public_prefix", "token"])
      expect(text).not.toContain(secret);
  });

  test("an admin can, a viewer cannot", async () => {
    const w = await createWorkspace();
    await expect(
      exported(await addMember(w, "admin"), w),
    ).resolves.toBeDefined();
    await rejects(exported(await addMember(w, "viewer"), w), "FORBIDDEN");
  });

  test("contains only this workspace", async () => {
    const one = await workspaceWithToken();
    const two = await createWorkspace();
    const data = await exported(two.owner, two);
    expect(data.agents).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(one.agent.key + "-dev");
  });
});

test("a freshly migrated database contains no waitlist tables", async () => {
  const [row] = await admin.query(
    `SELECT to_regclass('public.waitlist_subscribers') IS NOT NULL AS subscribers,
            to_regclass('public.waitlist_rate_limits') IS NOT NULL AS attempts`,
  );
  expect(row).toEqual({ subscribers: false, attempts: false });
});

describe("retention", () => {
  const backdate = (agent: { actionId: string }, days: number) =>
    admin.query(
      `UPDATE nodrail.action_requests
       SET created_at = created_at - make_interval(days => $2),
           expires_at = expires_at - make_interval(days => $2)
       WHERE id = $1`,
      [agent.actionId, days],
    );

  const action = (agent: { actionId: string }) =>
    admin.getRepository(ActionRequest).findOneByOrFail({ id: agent.actionId });

  test("clears old content but keeps what happened", async () => {
    const w = await createWorkspace();
    const old = await createAgent(w, "old");
    const recent = await createAgent(w, "recent");
    await backdate(old, 91);
    expect(await applyRetention()).not.toHaveProperty("waitlist");
    expect(await action(old)).toMatchObject({
      resourceId: EXPIRED_TEXT,
      paramsSafe: {},
      toolKey: "github",
      operationKey: "issues.delete",
    });
    expect((await action(recent)).paramsSafe).toEqual({ issue: 482 });
  });

  async function auditDetailAfter(days: number) {
    const w = await createWorkspace();
    await admin.query(
      `INSERT INTO nodrail.audit_events
         (workspace_id, event_type, actor_kind, decision_code, payload_safe,
          occurred_at)
       VALUES ($1, 'agent.paused', 'system', 'agent_paused', '{"subject":"x"}',
               now() - make_interval(days => $2))`,
      [w.id, days],
    );
    await applyRetention();
    const [row]: { payload_safe: object }[] = await admin.query(
      `SELECT payload_safe FROM nodrail.audit_events WHERE workspace_id = $1`,
      [w.id],
    );
    return row?.payload_safe;
  }

  test("clears old audit detail after a year, keeping the event", async () => {
    expect(await auditDetailAfter(366)).toEqual({});
  });

  test("recent audit detail is left alone", async () => {
    expect(await auditDetailAfter(364)).toEqual({ subject: "x" });
  });

  test("delivered emails go after a month", async () => {
    const w = await createWorkspace();
    // Not due yet, so delivery tests running alongside can't claim the rows.
    const insert = (state: string, days: number) =>
      admin.query(
        `INSERT INTO nodrail.notification_outbox
           (workspace_id, kind, recipient_user_id, recipient_email, dedupe_key,
            state, created_at, available_at)
         VALUES ($1, 'integration_stale', $2, 'a@b.test', $3, $4,
                 now() - make_interval(days => $5),
                 now() + interval '1 day')`,
        [w.id, w.owner.userId, randomUUID(), state, days],
      );
    await insert("delivered", 31);
    await insert("delivered", 5);
    await insert("pending", 31);
    await applyRetention();
    const rows: { state: string }[] = await admin.query(
      `SELECT state FROM nodrail.notification_outbox
       WHERE workspace_id = $1 ORDER BY state`,
      [w.id],
    );
    expect(rows.map((row) => row.state)).toEqual(["delivered", "pending"]);
  });

  const asRole = (role: string, sql: string) =>
    appDirect.transaction(async (manager) => {
      await manager.query(`SET LOCAL ROLE ${role}`);
      return manager.query(sql);
    });

  test.each([
    "SELECT * FROM nodrail.users",
    "SELECT * FROM nodrail.installation_credentials",
    "UPDATE nodrail.audit_events SET decision_code = 'x'",
    "DELETE FROM nodrail.audit_events",
    "UPDATE nodrail.action_requests SET tool_key = 'x'",
    "UPDATE nodrail.run_steps SET verdict = 'x'",
    "UPDATE nodrail.runs SET key = 'x'",
  ])("the maintenance role is refused: %s", async (sql) => {
    await expect(asRole("nodrail_maintenance", sql)).rejects.toThrow(
      /permission denied/,
    );
  });

  test("the application role still cannot rewrite the audit log", async () => {
    await expect(
      appDirect.query("UPDATE nodrail.audit_events SET payload_safe = '{}'"),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("retention for runs", () => {
  const ageSteps = (runKey: string, days: number) =>
    admin.query(
      `UPDATE nodrail.run_steps s
       SET started_at = started_at - make_interval(days => $2),
           finished_at = finished_at - make_interval(days => $2)
       FROM nodrail.runs r
       WHERE r.id = s.run_id AND r.key = $1`,
      [runKey, days],
    );

  const ageRun = (workspaceId: string, runKey: string, days: number) =>
    admin.query(
      `UPDATE nodrail.runs
       SET last_activity_at = clock_timestamp() - make_interval(days => $3)
       WHERE workspace_id = $1 AND key = $2`,
      [workspaceId, runKey, days],
    );

  const finishWithFindings = (token: string, key: string) =>
    step(token, {
      run: { key },
      step: { id: "qa-1", agent: "qa" },
      event: "finished",
      receipt: { verdict: "pass", findings: ["flaky"], usage: { tokens: 5 } },
    });

  const receipts = (workspaceId: string) =>
    admin.query(
      `SELECT r.key, s.verdict, s.receipt FROM nodrail.run_steps s
       JOIN nodrail.runs r ON r.id = s.run_id
       WHERE s.workspace_id = $1 ORDER BY r.key`,
      [workspaceId],
    );

  test("a step's findings go after 90 days; its verdict and usage stay", async () => {
    const { w, token } = await rig();
    const [old, recent] = [`old-${randomUUID()}`, `new-${randomUUID()}`];
    await finishWithFindings(token, old);
    await finishWithFindings(token, recent);
    await ageSteps(old, 91);
    await applyRetention();
    expect(await receipts(w.id)).toEqual([
      {
        key: recent,
        verdict: "pass",
        receipt: { findings: ["flaky"], usage: { tokens: 5 } },
      },
      { key: old, verdict: "pass", receipt: { usage: { tokens: 5 } } },
    ]);
  });

  test("a run idle for a year goes with its steps; its actions stay", async () => {
    const { w, token } = await rig();
    const run = { key: "feat/old", step: { id: "d1", agent: "dev" } };
    const held = await dispatch(token, "helper", run);
    await work(token, run.key, "qa", "pass");
    await work(token, "feat/recent", "qa", "pass");
    await ageRun(w.id, run.key, 366);
    await ageRun(w.id, "feat/recent", 364);
    await applyRetention();
    const runs: { key: string }[] = await admin.query(
      `SELECT key FROM nodrail.runs WHERE workspace_id = $1`,
      [w.id],
    );
    expect(runs.map((row) => row.key)).toEqual(["feat/recent"]);
    expect(await receipts(w.id)).toHaveLength(1);
    const action = await admin
      .getRepository(ActionRequest)
      .findOneByOrFail({ id: held.action_id });
    expect(action).toMatchObject({
      runId: null,
      stepKey: null,
      toolKey: "claude-code",
    });
  });

  test("a failure in run retention leaves the rest of retention done", async () => {
    const { w, token } = await rig();
    const key = `explodes-${randomUUID()}`;
    await work(token, key, "qa", "pass");
    await ageRun(w.id, key, 366);
    await admin.query(
      `INSERT INTO nodrail.notification_outbox
         (workspace_id, kind, recipient_user_id, recipient_email, dedupe_key,
          state, created_at, available_at)
       VALUES ($1, 'integration_stale', $2, 'a@b.test', $3, 'delivered',
               now() - interval '31 days', now() + interval '1 day')`,
      [w.id, w.owner.userId, randomUUID()],
    );
    await admin.query(`
      CREATE FUNCTION nodrail.test_explode() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.key LIKE 'explodes-%' THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN OLD;
      END $$;
      CREATE TRIGGER test_explode BEFORE DELETE ON nodrail.runs
        FOR EACH ROW EXECUTE FUNCTION nodrail.test_explode();
    `);
    try {
      expect(await applyRetention()).toMatchObject({ runs: null, steps: null });
    } finally {
      await admin.query(`
        DROP TRIGGER test_explode ON nodrail.runs;
        DROP FUNCTION nodrail.test_explode();
      `);
    }
    const emails: unknown[] = await admin.query(
      `SELECT 1 FROM nodrail.notification_outbox WHERE workspace_id = $1`,
      [w.id],
    );
    expect(emails).toEqual([]);
  });
});
