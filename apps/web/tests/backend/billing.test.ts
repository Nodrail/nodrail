import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { stripeClient } from "@/server/billing/stripe";
import { readWorkspace, withRuntime, withWorkspace } from "@/server/db/context";
import { BillingUsage, WorkspaceBilling } from "@/server/db/usage-entities";
import { listActivity } from "@/server/modules/activity";
import {
  createOrReuseCheckout,
  getBilling,
  prepareCheckout,
  preparePortal,
  receiveStripeWebhook,
  saveCustomer,
} from "@/server/modules/billing";
import { requestPermit } from "@/server/modules/runtime";
import { startFakeStripe } from "../../scripts/fake-stripe.mjs";
import {
  addMember,
  admin,
  checkIn,
  createAgent,
  createWorkspace,
  issueToken,
  retriedCallAndCheckIn,
  submitIssue,
  useDatabase,
  workspaceWithToken,
  type TestWorkspace,
  useDeployment,
} from "./world";

useDatabase();

const PRICE = "price_test_pro";
const statuses: number[] = [];
// Cloud plans; the self-hosted suite below sets its own mode.
useDeployment("cloud");

let fake: Awaited<ReturnType<typeof startFakeStripe>>;

beforeAll(async () => {
  fake = await startFakeStripe({
    apiKey: "sk_test_backend",
    webhookSecret: "whsec_backend",
    prices: [PRICE, "price_other", "price_earlier_pro"],
    deliver: async (payload: string, signature: string) => {
      statuses.push(await receiveStripeWebhook(payload, signature));
    },
  });
  vi.stubEnv("STRIPE_API_BASE", fake.base);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_backend");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_backend");
  vi.stubEnv("STRIPE_PRICE_PRO", PRICE);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
});

const ENV = "development";

const billingOf = (w: TestWorkspace) =>
  readWorkspace(w.owner, w.id, (context) => getBilling(context));

const stored = (w: TestWorkspace) =>
  admin.getRepository(WorkspaceBilling).findOneBy({ workspaceId: w.id });

/** The same steps the settings page takes. */
async function checkout(w: TestWorkspace, price = PRICE) {
  const stripe = stripeClient();
  const prepared = await withWorkspace(w.owner, w.id, (context) =>
    prepareCheckout(context),
  );
  const customerId =
    prepared.customerId ??
    (await stripe.customers.create({ metadata: { workspace_id: w.id } })).id;
  await withWorkspace(w.owner, w.id, (context) =>
    saveCustomer(context, customerId),
  );
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspace_id: w.id } },
    success_url: "http://x/ok",
    cancel_url: "http://x/no",
  });
}

async function subscribed(price = PRICE) {
  const w = await createWorkspace();
  const session = await checkout(w, price);
  const subscription = (await fake.pay(session.id)) as { id: string };
  return { w, subscription, customer: session.customer as string };
}

const setUsage = (w: TestWorkspace, intents: number, period?: string) =>
  admin.query(
    `INSERT INTO nodrail.billing_usage (workspace_id, period, intents)
     VALUES ($1, COALESCE($3::date, date_trunc('month', timezone('UTC', now()))::date), $2)
     ON CONFLICT (workspace_id, period) DO UPDATE SET intents = EXCLUDED.intents`,
    [w.id, intents, period ?? null],
  );

const usedThisMonth = async (w: TestWorkspace) => {
  const { usage } = await billingOf(w);
  return usage.used;
};

const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("the monthly allowance", () => {
  test("counts each new logical call, not retries or check-ins", async () => {
    const { w, token } = await workspaceWithToken();
    await retriedCallAndCheckIn(token);
    expect(await usedThisMonth(w)).toBe(1);
  });

  test("past it, a new call is refused and nothing is created", async () => {
    const { w, agent, token } = await workspaceWithToken();
    await setUsage(w, 1000);
    await rejects(submitIssue(token), "QUOTA_EXCEEDED");
    const [row]: { n: number }[] = await admin.query(
      `SELECT count(*)::int AS n FROM nodrail.action_requests
       WHERE workspace_id = $1 AND installation_id = $2
         AND operation_key = 'issues.create'`,
      [w.id, agent.installationId],
    );
    expect(row?.n).toBe(0);
    expect(await usedThisMonth(w)).toBe(1000);
  });

  test("repeating a call already made still answers past the limit", async () => {
    const { w, token } = await workspaceWithToken();
    const key = randomUUID();
    const first = await submitIssue(token, key);
    await setUsage(w, 1000);
    await expect(submitIssue(token, key)).resolves.toMatchObject({
      action_id: first.action_id,
    });
  });

  test("last month's usage does not count", async () => {
    const { w, token } = await workspaceWithToken();
    await setUsage(w, 1000, "2020-01-01");
    await expect(submitIssue(token)).resolves.toBeDefined();
  });

  test("each workspace has its own", async () => {
    const { w } = await workspaceWithToken();
    await setUsage(w, 1000);
    const other = await workspaceWithToken();
    await expect(submitIssue(other.token)).resolves.toBeDefined();
  });

  test("simultaneous calls cannot pass the limit", async () => {
    const { w, token } = await workspaceWithToken();
    await setUsage(w, 995);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => submitIssue(token)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(await usedThisMonth(w)).toBe(1000);
  });

  test("the paid plan has a higher allowance", async () => {
    const { w } = await subscribed();
    const agent = await createAgent(w, "bot");
    const token = await issueToken(w, agent);
    await setUsage(w, 1000);
    await expect(submitIssue(token)).resolves.toBeDefined();
    await setUsage(w, 100_000);
    await rejects(submitIssue(token), "QUOTA_EXCEEDED");
  });
});

describe("a self-hosted deployment (CW-06)", () => {
  const withMode = async (
    env: Record<string, string>,
    work: () => Promise<void>,
  ) => {
    const previous = { ...process.env };
    Object.assign(process.env, env);
    try {
      await work();
    } finally {
      for (const key of Object.keys(env))
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
    }
  };

  test("no Cloud Free allowance: past 1,000 actions, calls go on", async () => {
    await withMode({ NODRAIL_DEPLOYMENT: "self-hosted" }, async () => {
      const { w, token } = await workspaceWithToken();
      await setUsage(w, 1000);
      await expect(submitIssue(token)).resolves.toBeDefined();
      expect(await usedThisMonth(w)).toBe(1001);
      // No upgrade is offered: there is no Cloud plan to buy.
      const billing = await readWorkspace(w.owner, w.id, getBilling);
      expect(billing).toMatchObject({
        deployment: "self-hosted",
        available: false,
        recommendation: null,
      });
    });
  });

  test("an operator's own limit applies, named apart from Cloud's plans", async () => {
    await withMode(
      { NODRAIL_DEPLOYMENT: "self-hosted", NODRAIL_MONTHLY_ACTIONS: "1500" },
      async () => {
        const { w, token } = await workspaceWithToken();
        await setUsage(w, 1499);
        await expect(submitIssue(token)).resolves.toBeDefined();
        await rejects(submitIssue(token), "QUOTA_EXCEEDED");
      },
    );
  });

  test("missing or misspelled mode defaults to self-hosted", async () => {
    for (const mode of ["", "selfhosted"]) {
      await withMode({ NODRAIL_DEPLOYMENT: mode }, async () => {
        const { w, token } = await workspaceWithToken();
        await setUsage(w, 1000);
        await expect(submitIssue(token)).resolves.toBeDefined();
        expect(await receiveStripeWebhook("", "unused")).toBe(404);
      });
    }
  });
});

describe("billing never turns a block into an allow", () => {
  test("a denied request stays denied after an upgrade or a limit", async () => {
    const { w, token } = await workspaceWithToken();
    const action = await submitIssue(token);
    await setUsage(w, 1000);
    const permit = await withRuntime(token, "permits:request", (context) =>
      requestPermit(context, action.action_id, {
        action_digest: action.action_digest,
        nonce: randomUUID(),
      }),
    );
    expect(permit.code).toBe("DENIED");
  });

  test("check-ins keep working past the limit", async () => {
    const { w, token } = await workspaceWithToken();
    await setUsage(w, 1000);
    await expect(checkIn(token)).resolves.toEqual({ recorded: true });
  });
});

describe("subscribing", () => {
  test("a completed checkout makes the workspace Pro", async () => {
    const { w, customer } = await subscribed();
    expect(await billingOf(w)).toMatchObject({
      plan: "pro",
      usage: { limit: 100_000 },
      cancelAtPeriodEnd: false,
      hasCustomer: true,
    });
    expect(await stored(w)).toMatchObject({
      status: "active",
      stripeCustomerId: customer,
    });
  });

  test("the plan change is recorded once, however many events arrive", async () => {
    const { w } = await subscribed();
    const { items } = await readWorkspace(w.owner, w.id, (context) =>
      listActivity(context, ENV, { view: "changes" }),
    );
    expect(items.filter((i) => i.code === "billing_plan_changed")).toHaveLength(
      1,
    );
  });

  test("a price that is not the paid plan grants nothing", async () => {
    const { w } = await subscribed("price_other");
    expect((await billingOf(w)).plan).toBe("free");
  });

  test("an earlier Pro price that is still recognised keeps Pro", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO_RECOGNIZED", "price_earlier_pro");
    const { w } = await subscribed("price_earlier_pro");
    expect((await billingOf(w)).plan).toBe("pro");
    vi.stubEnv("STRIPE_PRICE_PRO_RECOGNIZED", "");
  });

  test("already Pro cannot start a second checkout", async () => {
    const { w } = await subscribed();
    await rejects(
      withWorkspace(w.owner, w.id, (context) => prepareCheckout(context)),
      "ALREADY_EXISTS",
    );
  });

  test.each(["admin", "policy_manager", "viewer"] as const)(
    "a %s cannot start checkout or open the portal",
    async (role) => {
      const { w } = await subscribed();
      const person = await addMember(w, role);
      await rejects(withWorkspace(person, w.id, prepareCheckout), "FORBIDDEN");
      await rejects(withWorkspace(person, w.id, preparePortal), "FORBIDDEN");
    },
  );

  test.each(["policy_manager", "viewer"] as const)(
    "a %s cannot read billing",
    async (role) => {
      const w = await createWorkspace();
      const person = await addMember(w, role);
      await rejects(
        readWorkspace(person, w.id, (context) => getBilling(context)),
        "FORBIDDEN",
      );
    },
  );

  test("an admin sees it but is told only the owner can change it", async () => {
    const w = await createWorkspace();
    const person = await addMember(w, "admin");
    await expect(
      readWorkspace(person, w.id, (context) => getBilling(context)),
    ).resolves.toMatchObject({ canManage: false, plan: "free" });
  });

  test("the portal needs a billing account", async () => {
    const w = await createWorkspace();
    await rejects(
      withWorkspace(w.owner, w.id, (context) => preparePortal(context)),
      "NOT_FOUND",
    );
  });

  test("a saved billing account is never replaced", async () => {
    const w = await createWorkspace();
    for (const id of ["cus_first", "cus_second"])
      await withWorkspace(w.owner, w.id, (context) =>
        saveCustomer(context, id),
      );
    expect((await stored(w))?.stripeCustomerId).toBe("cus_first");
  });
});

describe("after subscribing", () => {
  test("cancelling keeps the plan until the period ends", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, {
      cancel_at_period_end: true,
    });
    expect(await billingOf(w)).toMatchObject({
      plan: "pro",
      cancelAtPeriodEnd: true,
    });
  });

  test("a cancellation date counts as cancelling, as the portal sets it", async () => {
    const { w, subscription } = await subscribed();
    const endsAt = Math.floor(Date.now() / 1000) + 86_400;
    await fake.updateSubscription(subscription.id, { cancel_at: endsAt });
    expect(await billingOf(w)).toMatchObject({
      plan: "pro",
      cancelAtPeriodEnd: true,
      renewsOrEndsAt: new Date(endsAt * 1000).toISOString(),
    });
  });

  test("when it ends the workspace returns to free", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "canceled" });
    expect(await billingOf(w)).toMatchObject({
      plan: "free",
      renewsOrEndsAt: null,
    });
    expect((await stored(w))?.stripeSubscriptionId).toBeNull();
  });

  test("a failed payment keeps the plan during the grace period", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "past_due" });
    const billing = await billingOf(w);
    expect(billing.plan).toBe("pro");
    expect(billing.paymentFailedUntil).not.toBeNull();
  });

  test("the grace period is not restarted by more failures", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "past_due" });
    const first = (await stored(w))?.pastDueSince;
    await fake.updateSubscription(subscription.id, { status: "unpaid" });
    expect((await stored(w))?.pastDueSince).toEqual(first);
  });

  test("past the grace period it falls back to free", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "past_due" });
    await admin
      .getRepository(WorkspaceBilling)
      .update(
        { workspaceId: w.id },
        { pastDueSince: new Date(Date.now() - 8 * 86_400_000) },
      );
    expect((await billingOf(w)).plan).toBe("free");
  });

  test("a recovered payment clears the failure", async () => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "past_due" });
    await fake.updateSubscription(subscription.id, { status: "active" });
    expect(await stored(w)).toMatchObject({ pastDueSince: null });
    expect((await billingOf(w)).paymentFailedUntil).toBeNull();
  });
});

const openSession = (customer: string, workspaceId: string) =>
  stripeClient().checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: PRICE, quantity: 1 }],
    subscription_data: { metadata: { workspace_id: workspaceId } },
    success_url: "http://x/a",
    cancel_url: "http://x/b",
  });

/** For events that are expected to log a refusal. */
async function quietly(run: () => Promise<unknown>) {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await run();
  error.mockRestore();
}

describe("webhooks", () => {
  const eventFor = (subscriptionId: string) =>
    JSON.stringify({
      id: "evt_x",
      object: "event",
      type: "customer.subscription.updated",
      data: { object: { id: subscriptionId } },
    });

  test.each([
    ["no signature", null],
    ["a forged signature", "t=1,v1=abc"],
  ])("%s is refused", async (_label, signature) => {
    const { w, subscription } = await subscribed();
    await fake.updateSubscription(subscription.id, { status: "canceled" });
    expect(
      await receiveStripeWebhook(eventFor(subscription.id), signature),
    ).toBe(400);
    expect((await billingOf(w)).plan).toBe("free");
  });

  test("a stale or repeated event lands on Stripe's current state", async () => {
    const { w, subscription } = await subscribed();
    const [created] = fake
      .eventsOf("customer.subscription.created")
      .filter(
        (event: { data: { object: { id: string } } }) =>
          event.data.object.id === subscription.id,
      );
    await fake.updateSubscription(subscription.id, { status: "canceled" });
    await fake.send(created);
    expect((await billingOf(w)).plan).toBe("free");
  });

  test("an event for an unknown workspace is accepted and ignored", async () => {
    const stripe = stripeClient();
    const customer = await stripe.customers.create({});
    const session = await openSession(customer.id, randomUUID());
    statuses.length = 0;
    await fake.pay(session.id);
    expect(statuses).toEqual([200, 200]);
  });

  test("a subscription naming someone else's customer is ignored", async () => {
    const w = await createWorkspace();
    await withWorkspace(w.owner, w.id, (context) =>
      saveCustomer(context, "cus_the_real_one"),
    );
    const stripe = stripeClient();
    const customer = await stripe.customers.create({});
    const session = await openSession(customer.id, w.id);
    await quietly(() => fake.pay(session.id));
    expect((await billingOf(w)).plan).toBe("free");
  });

  test("a second subscription is cancelled, and the first stays", async () => {
    const { w, subscription, customer } = await subscribed();
    const session = await openSession(customer, w.id);
    let duplicate = "";
    await quietly(async () => {
      duplicate = ((await fake.pay(session.id)) as { id: string }).id;
      await vi.waitFor(() =>
        expect(
          fake
            .eventsOf("customer.subscription.deleted")
            .some(
              (event: { data: { object: { id: string } } }) =>
                event.data.object.id === duplicate,
            ),
        ).toBe(true),
      );
    });
    expect((await stored(w))?.stripeSubscriptionId).toBe(subscription.id);
    expect((await billingOf(w)).plan).toBe("pro");
  });

  test("two tabs share one checkout", async () => {
    const w = await createWorkspace();
    const customer = await stripeClient().customers.create({});
    const prepared = {
      workspaceId: w.id,
      customerId: customer.id,
      openCheckoutId: null,
    };
    const first = await createOrReuseCheckout(prepared, "http://x/settings");
    const raced = await createOrReuseCheckout(prepared, "http://x/settings");
    expect(raced.id).toBe(first.id);
    // A different key, so only the stored session can explain the same answer.
    const reopened = await createOrReuseCheckout(
      {
        ...prepared,
        workspaceId: randomUUID(),
        openCheckoutId: first.id,
      },
      "http://x/settings",
    );
    expect(reopened.id).toBe(first.id);
  });

  test("a finished checkout is not reused", async () => {
    const w = await createWorkspace();
    const customer = await stripeClient().customers.create({});
    const finished = await openSession(customer.id, w.id);
    await fake.pay(finished.id);
    const next = await createOrReuseCheckout(
      {
        workspaceId: randomUUID(),
        customerId: customer.id,
        openCheckoutId: finished.id,
      },
      "http://x/settings",
    );
    expect(next.id).not.toBe(finished.id);
  });

  test("if Stripe cannot be read, it is told to try again", async () => {
    statuses.length = 0;
    await quietly(() =>
      fake.send({
        id: "evt_missing",
        object: "event",
        type: "customer.subscription.updated",
        data: { object: { id: "sub_does_not_exist" } },
      }),
    );
    expect(statuses).toEqual([500]);
  });

  test("events it does not use are acknowledged", async () => {
    statuses.length = 0;
    await fake.send({
      id: "evt_other",
      object: "event",
      type: "invoice.created",
      data: { object: { id: "in_1" } },
    });
    expect(statuses).toEqual([200]);
  });
});

test("usage rows are per workspace and month", async () => {
  const w = await createWorkspace();
  await setUsage(w, 3);
  await setUsage(w, 4, "2020-01-01");
  expect(
    await admin.getRepository(BillingUsage).countBy({ workspaceId: w.id }),
  ).toBe(2);
});
