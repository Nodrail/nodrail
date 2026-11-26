import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import * as contexts from "@/server/db/context";
import { asSystem, withRuntime, withWorkspace } from "@/server/db/context";
import { Installation, NotificationPreferences } from "@/server/db/entities";
import { NotificationOutbox } from "@/server/db/notification-entities";
import { eraseAccount } from "@/server/modules/account";
import { pauseAgent } from "@/server/modules/agents";
import { transferOwnership } from "@/server/modules/team/members";
import { submitAction } from "@/server/modules/runtime";
import {
  deliverNotifications,
  queueStaleIntegrationAlerts,
} from "@/server/notifications/delivery";
import { deliverNextNotification } from "@/server/notifications/notification-claims";
import type { OutgoingEmail, SendEmail } from "@/server/notifications/mailer";
import { sendEmail } from "@/server/notifications/mailer";
import { enqueueNotification } from "@/server/notifications/outbox";
import {
  addMember,
  admin,
  appDirect,
  createAgent,
  createWorkspace,
  issueToken,
  useDatabase,
  type Person,
  type TestAgent,
  type TestWorkspace,
} from "./world";

useDatabase();

const outbox = () => admin.getRepository(NotificationOutbox);

const submit = (token: string, overrides: object = {}) =>
  withRuntime(token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      tool: "github",
      operation: "issues.create",
      resource: { kind: "repository", id: "acme/secret-project" },
      params: { title: "TOP-SECRET" },
      ...overrides,
    }),
  );

async function scenario(assign: (w: TestWorkspace) => Promise<Person[]>) {
  const w = await createWorkspace();
  const people = await assign(w);
  const agent = await createAgent(w, "bot", people);
  return { w, agent, token: await issueToken(w, agent), people };
}

const recipients = async (w: TestWorkspace) =>
  (await outbox().findBy({ workspaceId: w.id }))
    .map((row) => row.recipientUserId)
    .sort();

/**
 * Delivery is global and other test files queue notifications too, so emails are
 * kept per recipient and the batch is large enough to reach this test's rows.
 */
const collect = (recipient: Person) => {
  const sent: OutgoingEmail[] = [];
  const send: SendEmail = (email) => {
    if (email.to === recipient.email) sent.push(email);
    return Promise.resolve();
  };
  return { sent, send };
};

const origin = "https://app.example";
const deliver = (send: SendEmail) =>
  deliverNotifications({ send, origin, batch: 1000 });

const down: SendEmail = () => Promise.reject(new Error("smtp down"));

/** An integration silent long enough to alert about, and the alert queued. */
async function raise(agent: TestAgent) {
  await admin
    .getRepository(Installation)
    .update(
      { id: agent.installationId },
      { lastSeenAt: new Date(Date.now() - 45 * 60_000) },
    );
  await queueStaleIntegrationAlerts();
}

const state = async (w: TestWorkspace) =>
  outbox().findOneByOrFail({ workspaceId: w.id });

const turnOffStaleAlerts = (w: TestWorkspace) =>
  admin.getRepository(NotificationPreferences).insert({
    workspaceId: w.id,
    userId: w.owner.userId,
    integrationStale: false,
    updatedAt: new Date(),
  });

/** As if a worker had claimed the row and then stopped. */
const leased = (w: TestWorkspace, attempts: number, msFromNow: number) =>
  outbox().update(
    { workspaceId: w.id },
    {
      state: "sending",
      attempts,
      leaseUntil: new Date(Date.now() + msFromNow),
    },
  );

describe("who is told", () => {
  test("a call no rule covers is denied, and tells nobody", async () => {
    const { w, token } = await scenario(() => Promise.resolve([]));
    expect((await submit(token)).code).toBe("DENIED");
    expect(await recipients(w)).toEqual([]);
  });

  test("a person who turned alerts off is not told", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await turnOffStaleAlerts(w);
    await raise(agent);
    expect(await recipients(w)).toEqual([]);
  });
});

test("an enqueue rechecks recipients when erasure commits after selection", async () => {
  const w = await createWorkspace();
  const person = await addMember(w, "policy_manager");
  await asSystem(w.id, async (scope) => {
    const query = scope.manager.query.bind(scope.manager);
    let erased = false;
    const spy = vi
      .spyOn(scope.manager, "query")
      .mockImplementation(async (sql, parameters) => {
        const result: unknown = await query(sql, parameters);
        if (!erased && sql.includes("SELECT m.user_id, u.verified_email")) {
          expect(result).toContainEqual({
            user_id: person.userId,
            verified_email: person.email,
          });
          erased = true;
          await eraseAccount(person, person.email);
        }
        return result;
      });
    try {
      await enqueueNotification(scope, {
        kind: "integration_stale",
        agentId: null,
        dedupe: "erase-race",
        payload: {
          workspace: "Workspace",
          environment: "Development",
          agent: "machine",
          subject: "Machine",
          reference: null,
          path: "/",
          expiresAt: null,
        },
      });
      expect(erased).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  expect(await recipients(w)).toEqual([w.owner.userId]);
  expect(await outbox().findBy({ recipientEmail: person.email })).toEqual([]);
});

const staleNotice = {
  kind: "integration_stale" as const,
  agentId: null,
  dedupe: "concurrent-notice",
  payload: {
    workspace: "Workspace",
    environment: "Development",
    agent: "machine",
    subject: "Machine",
    reference: null,
    path: "/",
    expiresAt: null,
  },
};

test("recipient recheck can run alongside ownership transfer", async () => {
  const w = await createWorkspace();
  const second = await addMember(w, "admin");
  const [incoming, owner] = [w.owner, second].sort((a, b) =>
    a.userId.localeCompare(b.userId),
  );
  if (owner === second)
    await withWorkspace(w.owner, w.id, (context) =>
      transferOwnership(context, owner!.userId),
    );
  const tookIncoming = Promise.withResolvers<void>();
  const enteredTransfer = Promise.withResolvers<void>();
  const enqueue = asSystem(w.id, async (scope) => {
    const query = scope.manager.query.bind(scope.manager);
    const spy = vi
      .spyOn(scope.manager, "query")
      .mockImplementation(async (sql, parameters) => {
        const rows: unknown = await query(sql, parameters);
        if (
          sql.includes("SELECT user_id FROM nodrail.workspace_memberships") &&
          Array.isArray(parameters) &&
          parameters[1] === incoming!.userId
        ) {
          tookIncoming.resolve();
          await enteredTransfer.promise;
        }
        return rows;
      });
    try {
      await enqueueNotification(scope, staleNotice);
    } finally {
      spy.mockRestore();
    }
  });
  const transfer = tookIncoming.promise.then(() =>
    withWorkspace(owner!, w.id, (context) => {
      enteredTransfer.resolve();
      return transferOwnership(context, incoming!.userId);
    }),
  );
  await Promise.all([enqueue, transfer]);
  expect(await recipients(w)).toEqual([incoming!.userId, owner!.userId]);
});

test("erasure after claim commit wins before SMTP begins", async () => {
  const w = await createWorkspace();
  const person = await addMember(w, "policy_manager");
  const id = randomUUID();
  await outbox().insert({
    id,
    workspaceId: w.id,
    kind: "integration_stale",
    recipientUserId: person.userId,
    recipientEmail: person.email,
    dedupeKey: id,
    availableAt: new Date(0),
  });
  const notify = contexts.asNotifier;
  const spy = vi
    .spyOn(contexts, "asNotifier")
    .mockImplementationOnce(async (run) => {
      const claimed = await notify(run);
      expect(await outbox().findOneByOrFail({ id })).toMatchObject({
        state: "sending",
      });
      await eraseAccount(person, person.email);
      return claimed;
    });
  const send = vi.fn<SendEmail>();
  try {
    expect(await deliverNextNotification(send, origin)).toBe("superseded");
    expect(send).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

describe("what is written", () => {
  test("agent-supplied detail stays out of the email and the outbox", async () => {
    const { w, token, agent } = await scenario(() => Promise.resolve([]));
    await submit(token);
    await raise(agent);
    const { sent, send } = collect(w.owner);
    const stored = JSON.stringify(await state(w));
    expect(stored).not.toContain("TOP-SECRET");
    expect(stored).not.toContain("secret-project");
    await deliver(send);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).not.toContain("TOP-SECRET");
    expect(JSON.stringify(sent[0])).not.toContain("secret-project");
  });
});

describe("delivery failing", () => {
  test("backs off, then gives up", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await deliver(down);
      const row = await state(w);
      expect(row.attempts).toBe(attempt);
      expect(row.state).toBe(attempt === 5 ? "failed" : "pending");
      expect(row.lastError).toBe("Error");
      if (attempt < 5) {
        expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
        await deliver(down);
        expect((await state(w)).attempts).toBe(attempt);
        await outbox().update({ id: row.id }, { availableAt: new Date(0) });
      }
    }
    await deliver(down);
    expect((await state(w)).attempts).toBe(5);
  });

  test("a provider error's text is not kept", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    await deliver(() => Promise.reject(new Error("rejected a@b.test")));
    expect((await state(w)).lastError).not.toContain("a@b.test");
  });

  test("succeeds on a later try", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    await deliver(down);
    await outbox().update({ workspaceId: w.id }, { availableAt: new Date(0) });
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent).toHaveLength(1);
    expect(await state(w)).toMatchObject({
      state: "delivered",
      attempts: 2,
      leaseUntil: null,
    });
  });

  test("a crash after sending retries when the lease ends", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    await leased(w, 1, -1000);
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent).toHaveLength(1);
    expect((await state(w)).state).toBe("delivered");
  });

  test("a live lease keeps others away", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    await leased(w, 1, 60_000);
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent).toHaveLength(0);
  });

  test("a stuck row at the limit is given up on", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    await leased(w, 5, -1000);
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent).toHaveLength(0);
    expect((await state(w)).state).toBe("failed");
  });

  test("a notice that already expired is not sent", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    const row = await state(w);
    await admin.query(
      `UPDATE nodrail.notification_outbox
       SET payload_safe = payload_safe || '{"expiresAt":"2020-01-01T00:00:00.000Z"}'
       WHERE id = $1`,
      [row.id],
    );
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent).toHaveLength(0);
    expect(await state(w)).toMatchObject({ state: "dropped", attempts: 0 });
  });

  test("two workers never send the same row", async () => {
    const w = await createWorkspace();
    const people = await Promise.all(
      Array.from({ length: 8 }, () => addMember(w, "policy_manager")),
    );
    const agent = await createAgent(w, "bot", people);
    await raise(agent);
    const ids: string[] = [];
    const send: SendEmail = (email) => {
      ids.push(email.messageId);
      return Promise.resolve();
    };
    await Promise.all(
      Array.from({ length: 4 }, () =>
        deliverNotifications({ send, batch: 3, origin }),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  test("erasure commits during a send longer than the erasure lock timeout", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "policy_manager");
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries())
      await outbox().insert({
        id,
        workspaceId: w.id,
        kind: "integration_stale",
        recipientUserId: index === 0 ? person.userId : w.owner.userId,
        recipientEmail: index === 0 ? person.email : w.owner.email,
        dedupeKey: id,
        availableAt: new Date(index),
      });

    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const sent: string[] = [];
    const delivery = deliverNotifications({
      batch: 2,
      origin,
      send: async ({ messageId }) => {
        sent.push(messageId);
        if (messageId !== ids[0]) return;
        started.resolve();
        await finish.promise;
      },
    });
    try {
      await started.promise;
      expect(await outbox().findOneByOrFail({ id: ids[1] })).toMatchObject({
        state: "pending",
        attempts: 0,
        leaseUntil: null,
      });
      const start = performance.now();
      await eraseAccount(person, person.email);
      expect(performance.now() - start).toBeLessThan(3_000);
      await new Promise((resolve) => setTimeout(resolve, 3_100));
      expect(await outbox().findOneByOrFail({ id: ids[0] })).toMatchObject({
        state: "dropped",
        recipientEmail: "erased@invalid",
        deliveredAt: null,
      });
    } finally {
      finish.resolve();
      await delivery;
    }
    expect(sent).toEqual(ids);
    expect(await outbox().findOneByOrFail({ id: ids[0] })).toMatchObject({
      state: "dropped",
      leaseUntil: null,
      lastError: "sent before erasure",
      deliveredAt: expect.any(Date),
      attempts: 1,
    });
    expect(await outbox().findOneByOrFail({ id: ids[1] })).toMatchObject({
      state: "delivered",
      attempts: 1,
    });
    await deliverNotifications({
      send: () => {
        throw new Error("unexpected second send");
      },
      origin,
    });
    expect(await outbox().findOneByOrFail({ id: ids[0] })).toMatchObject({
      attempts: 1,
    });
  }, 12_000);

  test("unconfigured email leaves everything queued", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await raise(agent);
    vi.stubEnv("SMTP_URL", "");
    await expect(deliverNotifications()).resolves.toEqual({
      delivered: 0,
      retried: 0,
      dropped: 0,
    });
    vi.unstubAllEnvs();
    expect(await state(w)).toMatchObject({ state: "pending", attempts: 0 });
  });
});

test("the send deadline aborts an in-flight SMTP socket", async () => {
  const connected = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();
  const server = createServer((socket) => {
    socket.once("close", () => closed.resolve());
    connected.resolve();
    // Hold the greeting until the sender aborts. No message can be accepted.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("SMTP listener failed");
  vi.stubEnv("SMTP_URL", `smtp://127.0.0.1:${address.port}`);
  vi.stubEnv("NOTIFICATIONS_FROM", "tests@example.test");
  const controller = new AbortController();
  try {
    const sending = sendEmail(
      {
        to: "person@example.test",
        messageId: "deadline",
        subject: "Test",
        text: "Test",
        html: "<p>Test</p>",
      },
      controller.signal,
    );
    const aborted = expect(sending).rejects.toMatchObject({
      name: "AbortError",
    });
    await connected.promise;
    controller.abort();
    await aborted;
    await closed.promise;
  } finally {
    controller.abort();
    server.close();
    vi.unstubAllEnvs();
  }
});

describe("the delivery role", () => {
  const asNotifierRole = (sql: string) =>
    appDirect.transaction(async (manager) => {
      await manager.query("SET LOCAL ROLE nodrail_notifier");
      return manager.query(sql);
    });

  test.each([
    "SELECT * FROM nodrail.action_requests",
    "SELECT * FROM nodrail.decision_permits",
    "SELECT * FROM nodrail.policy_rules",
    "SELECT * FROM nodrail.users",
    "SELECT * FROM nodrail.installation_credentials",
    "SELECT name FROM nodrail.workspaces",
    "INSERT INTO nodrail.decision_permits (workspace_id) VALUES (gen_random_uuid())",
    "DELETE FROM nodrail.notification_outbox",
    "UPDATE nodrail.notification_outbox SET recipient_email = 'x@y.z'",
    "UPDATE nodrail.notification_outbox SET payload_safe = '{}'",
  ])("is refused: %s", async (sql) => {
    await expect(asNotifierRole(sql)).rejects.toThrow(/permission denied/);
  });
});

describe("silent integrations", () => {
  const stale = (agent: TestAgent, minutes: number) =>
    admin
      .getRepository(Installation)
      .update(
        { id: agent.installationId },
        { lastSeenAt: new Date(Date.now() - minutes * 60_000) },
      );

  const staleRows = (w: TestWorkspace) =>
    outbox().findBy({ workspaceId: w.id, kind: "integration_stale" });

  test("alert once per silence", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await stale(agent, 45);
    await queueStaleIntegrationAlerts();
    await queueStaleIntegrationAlerts();
    expect(await staleRows(w)).toHaveLength(1);
    await stale(agent, 40);
    await queueStaleIntegrationAlerts();
    expect(await staleRows(w)).toHaveLength(2);
  });

  test("ignore recent, never-seen and paused integrations", async () => {
    const w = await createWorkspace();
    const recent = await createAgent(w, "recent");
    await createAgent(w, "never");
    const paused = await createAgent(w, "paused");
    await stale(recent, 5);
    await stale(paused, 45);
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "paused"),
    );
    await queueStaleIntegrationAlerts();
    expect(await staleRows(w)).toEqual([]);
  });

  test("reach only people who can act on it", async () => {
    let manager: Person;
    const { w, agent } = await scenario(async (space) => {
      manager = await addMember(space, "policy_manager");
      // A viewer may see the agent but can't act on it.
      return [await addMember(space, "viewer")];
    });
    await stale(agent, 45);
    await queueStaleIntegrationAlerts();
    expect((await staleRows(w)).map((r) => r.recipientUserId).sort()).toEqual(
      [w.owner.userId, manager!.userId].sort(),
    );
  });

  test("read as an alert about the agent", async () => {
    const { w, agent } = await scenario(() => Promise.resolve([]));
    await stale(agent, 45);
    await queueStaleIntegrationAlerts();
    const { sent, send } = collect(w.owner);
    await deliver(send);
    expect(sent[0]?.subject).toBe("[Test] bot stopped reporting");
    expect(sent[0]?.text).toContain("/agents/bot");
  });
});

describe("real SMTP", () => {
  test("reaches the local inbox", async () => {
    vi.stubEnv("SMTP_URL", "smtp://127.0.0.1:55325");
    vi.stubEnv("SMTP_PLAINTEXT_HOST", "127.0.0.1");
    vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3100");
    vi.stubEnv("NOTIFICATIONS_FROM", "Nodrail <n@nodrail.test>");
    const to = `smtp-${randomUUID()}@example.test`;
    await sendEmail({
      to,
      messageId: randomUUID(),
      subject: "Hello",
      text: "Plain",
      html: "<p>Plain</p>",
    });
    vi.unstubAllEnvs();
    const search = await fetch(
      `http://127.0.0.1:55324/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await search.json()) as {
      messages: { Subject: string }[];
    };
    expect(messages[0]?.Subject).toBe("Hello");
  });
});
