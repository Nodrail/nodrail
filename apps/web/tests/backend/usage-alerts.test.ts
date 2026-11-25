import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { UsageAlertPayload } from "@/contracts/v1/notifications";
import { readWorkspace } from "@/server/db/context";
import { NotificationPreferences } from "@/server/db/entities";
import { NotificationOutbox } from "@/server/db/notification-entities";
import { getBilling } from "@/server/modules/billing";
import { deliverNotifications } from "@/server/notifications/delivery";
import type { OutgoingEmail, SendEmail } from "@/server/notifications/mailer";
import { rig, step } from "./runs-world";
import {
  addMember,
  admin,
  submitIssue,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
  useDeployment,
} from "./world";

useDatabase();

const thisMonth = `date_trunc('month', timezone('UTC', now()))::date`;
const monthsAgo = (n: number) =>
  `(date_trunc('month', timezone('UTC', now())) - make_interval(months => ${n}))::date`;

const setCounts = (
  w: TestWorkspace,
  counts: { intents?: number; steps?: number },
  period = thisMonth,
) =>
  admin.query(
    `INSERT INTO nodrail.billing_usage (workspace_id, period, intents, steps)
     VALUES ($1, ${period}, $2, $3)
     ON CONFLICT (workspace_id, period) DO UPDATE
     SET intents = EXCLUDED.intents, steps = EXCLUDED.steps`,
    [w.id, counts.intents ?? 0, counts.steps ?? 0],
  );

const alerts = (w: TestWorkspace): Promise<object[]> =>
  admin.query(
    `SELECT metric, threshold, used, allowance,
            period = ${thisMonth} AS this_month
     FROM nodrail.usage_alerts WHERE workspace_id = $1
     ORDER BY period, metric, threshold`,
    [w.id],
  );

const usageMail = (w: TestWorkspace) =>
  admin.getRepository(NotificationOutbox).find({
    where: { workspaceId: w.id, kind: "usage_alert" },
    order: { createdAt: "ASC" },
  });

const recipients = async (w: TestWorkspace) =>
  (await usageMail(w)).map((row) => row.recipientUserId).sort();

const used = async (w: TestWorkspace) =>
  (await readWorkspace(w.owner, w.id, (context) => getBilling(context))).usage
    .used;

const submitMany = async (token: string, n: number) => {
  for (let i = 0; i < n; i += 1) await submitIssue(token);
};

// Cloud plans: Free and Pro allowances only exist on Cloud.
useDeployment("cloud");

describe("crossing a threshold", () => {
  test("80 % and 100 % are each recorded once, with the count that met them", async () => {
    const { w, token } = await workspaceWithToken();
    await setCounts(w, { intents: 798 });
    await submitMany(token, 3);
    expect(await alerts(w)).toEqual([
      {
        metric: "actions",
        threshold: 80,
        used: 800,
        allowance: 1000,
        this_month: true,
      },
    ]);

    await setCounts(w, { intents: 998 });
    await submitMany(token, 2);
    await expect(submitIssue(token)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
    });
    // Meeting a threshold again in the same month says nothing new.
    await setCounts(w, { intents: 799 });
    await submitIssue(token);
    expect(await alerts(w)).toHaveLength(2);
    expect((await usageMail(w)).map((row) => row.payloadSafe)).toEqual([
      expect.objectContaining({ threshold: 80, used: 800, limit: 1000 }),
      expect.objectContaining({ threshold: 100, used: 1000, limit: 1000 }),
    ]);
  });

  test("concurrent calls around the threshold raise one alert", async () => {
    const { w, token } = await workspaceWithToken();
    await setCounts(w, { intents: 790 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => submitIssue(token)),
    );
    const accepted = results.filter((r) => r.status === "fulfilled").length;
    expect(accepted).toBeGreaterThan(10);
    expect(await used(w)).toBe(790 + accepted);
    expect(await alerts(w)).toHaveLength(1);
    expect(await recipients(w)).toEqual([w.owner.userId]);
  });

  test("a new month starts over", async () => {
    const { w, token } = await workspaceWithToken();
    await setCounts(w, { intents: 1000 }, monthsAgo(1));
    await admin.query(
      `INSERT INTO nodrail.usage_alerts
         (workspace_id, period, metric, threshold, used, allowance)
       VALUES ($1, ${monthsAgo(1)}, 'actions', 80, 800, 1000)`,
      [w.id],
    );
    await setCounts(w, { intents: 799 });
    await submitIssue(token);
    expect(await alerts(w)).toEqual([
      expect.objectContaining({ threshold: 80, this_month: false }),
      expect.objectContaining({ threshold: 80, this_month: true }),
    ]);
    expect(await usageMail(w)).toHaveLength(1);
  });

  test("a step counts towards its own allowance and alert", async () => {
    const { w, token } = await rig();
    await setCounts(w, { steps: 999 });
    await step(token, {
      run: { key: "ENG-1" },
      step: { id: randomUUID(), agent: "qa" },
      event: "started",
    });
    expect(await alerts(w)).toEqual([
      expect.objectContaining({ metric: "steps", threshold: 100, used: 1000 }),
    ]);
    const [mail] = await usageMail(w);
    expect(mail?.payloadSafe).toMatchObject({
      metric: "steps",
      threshold: 100,
      recommendation: null,
    });
  });
});

describe("who is told", () => {
  test("only people who manage billing, unless they turned it off", async () => {
    const { w, token } = await workspaceWithToken();
    const admins = [await addMember(w, "admin"), await addMember(w, "admin")];
    for (const role of ["policy_manager", "viewer"] as const)
      await addMember(w, role);
    await admin.getRepository(NotificationPreferences).insert({
      workspaceId: w.id,
      userId: admins[1]!.userId,
      usageAlerts: false,
      updatedAt: new Date(),
    });
    await setCounts(w, { intents: 799 });
    await submitIssue(token);
    expect(await recipients(w)).toEqual(
      [w.owner.userId, admins[0]!.userId].sort(),
    );
  });

  test("the 80 % email on Free carries a measured reason for Pro", async () => {
    const { w, token } = await workspaceWithToken();
    await setCounts(w, { intents: 900 }, monthsAgo(1));
    await setCounts(w, { intents: 950 }, monthsAgo(2));
    await setCounts(w, { intents: 799 });
    await submitIssue(token);
    const [mail] = await usageMail(w);
    const payload = mail?.payloadSafe as UsageAlertPayload;
    expect(["projected", "near_months"]).toContain(
      payload.recommendation?.reason,
    );
    expect(payload.path).toMatch(/\/settings\/billing#billing-usage$/);

    const sent: OutgoingEmail[] = [];
    const send: SendEmail = (email) => {
      if (email.to === w.owner.email) sent.push(email);
      return Promise.resolve();
    };
    await deliverNotifications({
      send,
      origin: "https://app.example",
      batch: 1000,
    });
    const email = sent.find((item) => /80%/.test(item.subject));
    expect(email?.subject).toBe(
      "You've used 80% of this month's agent actions in Test",
    );
    expect(email?.text).toContain("Pro raises the allowance to 100,000");
  });
});

describe("when alerting fails", () => {
  test("the action is still counted and answered", async () => {
    const { w, token } = await workspaceWithToken();
    const name = `fail_${w.id.replaceAll("-", "")}`;
    await admin.query(`
      CREATE FUNCTION nodrail.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.workspace_id = '${w.id}' THEN RAISE EXCEPTION 'alert down'; END IF;
        RETURN NEW;
      END $$`);
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON nodrail.usage_alerts
       FOR EACH ROW EXECUTE FUNCTION nodrail.${name}()`,
    );
    try {
      await setCounts(w, { intents: 799 });
      await expect(submitIssue(token)).resolves.toMatchObject({
        action_id: expect.any(String),
      });
      expect(await used(w)).toBe(800);
      expect(await alerts(w)).toEqual([]);
      expect(await usageMail(w)).toEqual([]);
    } finally {
      await admin.query(`DROP TRIGGER ${name} ON nodrail.usage_alerts`);
      await admin.query(`DROP FUNCTION nodrail.${name}()`);
    }
  });
});
