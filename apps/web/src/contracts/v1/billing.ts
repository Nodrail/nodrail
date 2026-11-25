// The offer is shared with the website's pricing page.
import { plans, type PlanKey } from "@nodrail/web-shared/plans";
import type { UpgradeRecommendation } from "./usage-alerts";

export { plans, type PlanKey };

/** How long a failed payment keeps the plan while Stripe retries. */
export const PAST_DUE_GRACE_DAYS = 7;
export const USAGE_WARNING_PERCENT = 80;

export type SubscriptionRecord = {
  plan: string;
  status: string;
  pastDueSince: Date | null;
};

/** What a workspace is entitled to right now, from what Stripe last told us. */
export function effectivePlan(
  record: SubscriptionRecord | null | undefined,
  now: Date,
): PlanKey {
  if (record?.plan !== "pro") return "free";
  if (record.status === "active" || record.status === "trialing") return "pro";
  if (record.status !== "past_due" && record.status !== "unpaid") return "free";
  const graceEnds =
    (record.pastDueSince?.getTime() ?? now.getTime()) +
    PAST_DUE_GRACE_DAYS * 86_400_000;
  return now.getTime() < graceEnds ? "pro" : "free";
}

export type UsageState = "ok" | "near" | "reached";

export type UsageDto = { used: number; limit: number; state: UsageState };

export function usageFrom(used: number, limit: number): UsageDto {
  const state =
    used >= limit
      ? "reached"
      : used * 100 >= limit * USAGE_WARNING_PERCENT
        ? "near"
        : "ok";
  return { used, limit, state };
}

export type BillingDto = {
  /** Self-hosted: no Cloud plan applies; limits are the operator's. */
  deployment: "cloud" | "self-hosted";
  plan: PlanKey;
  usage: UsageDto;
  /** Run steps recorded this month: free, up to the plan's allowance. */
  steps: UsageDto;
  /** When both allowances reset: the first of next month, 00:00 UTC. */
  resetsAt: string;
  /** Free only, and only with a reason someone can check. */
  recommendation: UpgradeRecommendation | null;
  renewsOrEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** When a failed payment stops keeping the paid plan. */
  paymentFailedUntil: string | null;
  canManage: boolean;
  /** Whether payments are set up on this server. */
  available: boolean;
  hasCustomer: boolean;
};
