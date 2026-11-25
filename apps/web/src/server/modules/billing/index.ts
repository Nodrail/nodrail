import "server-only";
import { z } from "zod";
import type Stripe from "stripe";
import {
  PAST_DUE_GRACE_DAYS,
  effectivePlan,
  plans,
  type BillingDto,
} from "@/contracts/v1/billing";
import { billingConfig, stripeClient } from "@/server/billing/stripe";
import {
  AppError,
  asSystem,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { recordSystemEvent } from "@/server/modules/audit";
import {
  recommendUpgrade,
  type UsageNoticeDto,
} from "@/contracts/v1/usage-alerts";
import { usageHistory } from "./usage-alerts";
import { getUsageNotice } from "./metering";
import { planOf, readBilling, type Scope } from "./stripe-entitlements";

export { metThreshold } from "./usage-alerts";
import { describeError } from "@/server/log";
import { deploymentMode } from "@/server/deployment";

/** Only for the billing card: it reads past months too. */
async function withRecommendation(scope: Scope, notice: UsageNoticeDto) {
  if (notice.deployment === "self-hosted" || notice.plan !== "free")
    return { ...notice, recommendation: null };
  const history = await usageHistory(scope);
  const now = new Date();
  return {
    ...notice,
    recommendation: recommendUpgrade({ ...notice, history, now }),
  };
}

export async function getBilling(
  context: WorkspaceContext,
): Promise<BillingDto> {
  requireCapability(context, "workspace:settings");
  const row =
    deploymentMode() === "cloud" ? await readBilling(context) : undefined;
  const plan = planOf(row);
  const notice = await withRecommendation(
    context,
    await getUsageNotice(context),
  );
  const failing = row?.status === "past_due" || row?.status === "unpaid";
  return {
    plan,
    deployment: notice.deployment,
    usage: notice.actions,
    steps: notice.steps,
    resetsAt: notice.resetsAt,
    recommendation: notice.recommendation,
    renewsOrEndsAt:
      plan === "pro" ? (row?.current_period_end?.toISOString() ?? null) : null,
    cancelAtPeriodEnd: plan === "pro" && (row?.cancel_at_period_end ?? false),
    paymentFailedUntil:
      plan === "pro" && failing && row?.past_due_since
        ? new Date(
            row.past_due_since.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000,
          ).toISOString()
        : null,
    canManage: context.capabilities.has("ownership:manage"),
    // Self-hosted: no Cloud plan to buy, whatever Stripe settings exist.
    available: billingConfig() !== null,
    hasCustomer: Boolean(row?.stripe_customer_id),
  };
}

/** Everything needed before calling Stripe, which happens outside any lock. */
export async function prepareCheckout(context: WorkspaceContext) {
  requireCapability(context, "ownership:manage");
  if (deploymentMode() !== "cloud") throw new AppError("NOT_FOUND");
  const row = await readBilling(context);
  if (planOf(row) === "pro") throw new AppError("ALREADY_EXISTS");
  return {
    workspaceId: context.workspaceId,
    customerId: row?.stripe_customer_id ?? null,
    openCheckoutId: row?.open_checkout_id ?? null,
  };
}

/**
 * Sends a second tab to the session already open, so one workspace can't be
 * charged twice. The key covers two clicks arriving before either is saved.
 */
export async function createOrReuseCheckout(
  prepared: {
    workspaceId: string;
    customerId: string;
    openCheckoutId: string | null;
  },
  settingsUrl: string,
) {
  const config = billingConfig();
  if (!config) throw new Error("Payments are not configured");
  const stripe = stripeClient();
  if (prepared.openCheckoutId) {
    const open = await stripe.checkout.sessions
      .retrieve(prepared.openCheckoutId)
      .catch(() => null);
    if (open?.status === "open" && open.url)
      return { id: open.id, url: open.url };
  }
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      customer: prepared.customerId,
      line_items: [{ price: config.proPriceId, quantity: 1 }],
      subscription_data: { metadata: { workspace_id: prepared.workspaceId } },
      success_url: `${settingsUrl}?billing=success`,
      cancel_url: `${settingsUrl}?billing=cancelled`,
    },
    {
      idempotencyKey: `checkout-${prepared.workspaceId}-${Math.floor(Date.now() / 600_000)}`,
    },
  );
  return { id: session.id, url: session.url };
}

export async function saveOpenCheckout(
  context: WorkspaceContext,
  checkoutId: string,
) {
  requireCapability(context, "ownership:manage");
  await context.manager.query(
    `UPDATE nodrail.workspace_billing SET open_checkout_id = $2
     WHERE workspace_id = $1`,
    [context.workspaceId, checkoutId],
  );
}

export async function preparePortal(context: WorkspaceContext) {
  requireCapability(context, "ownership:manage");
  if (deploymentMode() !== "cloud") throw new AppError("NOT_FOUND");
  const customerId = (await readBilling(context))?.stripe_customer_id;
  if (!customerId) throw new AppError("NOT_FOUND");
  return { customerId };
}

export async function saveCustomer(
  context: WorkspaceContext,
  customerId: string,
) {
  requireCapability(context, "ownership:manage");
  await context.manager.query(
    `INSERT INTO nodrail.workspace_billing (workspace_id, stripe_customer_id)
     VALUES ($1, $2)
     ON CONFLICT (workspace_id) DO UPDATE
     SET stripe_customer_id = COALESCE(
       nodrail.workspace_billing.stripe_customer_id, EXCLUDED.stripe_customer_id)`,
    [context.workspaceId, customerId],
  );
}

const customerIdOf = (subscription: Stripe.Subscription) =>
  typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;

const live = (status: string) =>
  ["active", "trialing", "past_due", "unpaid"].includes(status);

/**
 * Stores what Stripe says about a subscription. It is always read fresh from
 * Stripe first, so a repeated or out-of-order webhook lands on the same result.
 */
export async function applySubscription(
  subscription: Stripe.Subscription,
): Promise<"applied" | "duplicate"> {
  const workspaceId = subscription.metadata.workspace_id;
  if (!z.uuid().safeParse(workspaceId).success) return "applied";
  const config = billingConfig();
  const [item] = subscription.items.data;
  const isPro = config?.proPriceIds.has(item?.price.id ?? "") === true;
  const customerId = customerIdOf(subscription);

  return asSystem(workspaceId ?? "", async (scope) => {
    const { manager } = scope;
    const [exists]: unknown[] = await manager.query(
      `SELECT 1 FROM nodrail.workspaces WHERE id = $1`,
      [workspaceId],
    );
    if (!exists) return "applied";
    const current = await readBilling(scope, "FOR UPDATE");
    if (
      current?.stripe_customer_id &&
      current.stripe_customer_id !== customerId
    ) {
      console.error("Billing event ignored: customer does not match");
      return "applied";
    }
    const otherIsLive =
      current?.stripe_subscription_id &&
      current.stripe_subscription_id !== subscription.id &&
      live(current.status);
    if (otherIsLive) return live(subscription.status) ? "duplicate" : "applied";

    const before = planOf(current);
    const failing =
      subscription.status === "past_due" || subscription.status === "unpaid";
    const pastDueSince = failing
      ? (current?.past_due_since ?? new Date())
      : null;
    const ended = !live(subscription.status);
    const next = {
      plan: isPro && !ended ? "pro" : "free",
      status: subscription.status,
      pastDueSince,
    };
    await manager.query(
      `INSERT INTO nodrail.workspace_billing
         (workspace_id, plan, status, stripe_customer_id, stripe_subscription_id,
          current_period_end, cancel_at_period_end, past_due_since,
          open_checkout_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, clock_timestamp())
       ON CONFLICT (workspace_id) DO UPDATE
       SET plan = EXCLUDED.plan, status = EXCLUDED.status,
           stripe_customer_id = EXCLUDED.stripe_customer_id,
           stripe_subscription_id = EXCLUDED.stripe_subscription_id,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           past_due_since = EXCLUDED.past_due_since,
           open_checkout_id = NULL,
           updated_at = EXCLUDED.updated_at`,
      [
        workspaceId,
        next.plan,
        next.status,
        customerId,
        ended ? null : subscription.id,
        item
          ? new Date((subscription.cancel_at ?? item.current_period_end) * 1000)
          : null,
        // Stripe's portal sets a cancellation date and leaves the flag false.
        !ended &&
          (subscription.cancel_at_period_end ||
            subscription.cancel_at !== null),
        pastDueSince,
      ],
    );
    const after = effectivePlan(next, new Date());
    if (after !== before)
      await recordSystemEvent(scope, {
        eventType: "billing.plan_changed",
        decisionCode: "billing_plan_changed",
        payload: {
          subject: plans[after].label,
          detail: `${before} → ${after}`,
        },
      });
    return "applied";
  });
}

function subscriptionIdIn(event: Stripe.Event): string | null {
  const { object } = event.data as {
    object: { id: string; subscription?: unknown };
  };
  if (event.type === "checkout.session.completed")
    return typeof object.subscription === "string" ? object.subscription : null;
  return event.type.startsWith("customer.subscription.") ? object.id : null;
}

/** Returns the status for Stripe: a failure here makes it try again later. */
export async function receiveStripeWebhook(
  payload: string,
  signature: string | null,
): Promise<number> {
  const config = billingConfig();
  if (deploymentMode() !== "cloud") return 404;
  if (!config || !signature) return 400;
  const stripe = stripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      config.webhookSecret,
    );
  } catch {
    return 400;
  }
  try {
    const subscriptionId = subscriptionIdIn(event);
    if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if ((await applySubscription(subscription)) === "duplicate") {
        console.error("Billing: cancelled a duplicate subscription");
        await stripe.subscriptions.cancel(subscription.id);
      }
    }
    return 200;
  } catch (error) {
    console.error("Billing webhook failed", describeError(error));
    return 500;
  }
}
