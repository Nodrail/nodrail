import {
  USAGE_WARNING_PERCENT,
  plans,
  type PlanKey,
  type UsageDto,
} from "./billing";

export const usageMetrics = ["actions", "steps"] as const;
export type UsageMetric = (typeof usageMetrics)[number];

export const usageThresholds = [USAGE_WARNING_PERCENT, 100] as const;
export type UsageThreshold = (typeof usageThresholds)[number];

/** How each allowance is named to people. */
export const metricNouns: Record<UsageMetric, string> = {
  actions: "agent actions",
  steps: "run steps",
};

/** This month's usage for a banner: what anyone in the workspace may see. */
export type UsageNoticeDto = {
  plan: PlanKey;
  /** "2026-11": the UTC month the counts belong to. */
  period: string;
  /** The first moment of next month, UTC, when every allowance resets. */
  resetsAt: string;
  actions: UsageDto;
  steps: UsageDto;
  /** Self-hosted: no Cloud plan applies; limits are the operator's. */
  deployment: "cloud" | "self-hosted";
};

/** The count at which a threshold is met. Counts rise by one, so each is met once. */
export const thresholdCount = (limit: number, threshold: UsageThreshold) =>
  Math.ceil((limit * threshold) / 100);

/** The threshold a new count has just reached, if any. */
export function crossedAt(count: number, limit: number) {
  return usageThresholds.find(
    (threshold) => count === thresholdCount(limit, threshold),
  );
}

export const thresholdOf = (usage: UsageDto): UsageThreshold | null =>
  usage.state === "reached"
    ? 100
    : usage.state === "near"
      ? USAGE_WARNING_PERCENT
      : null;

const monthStart = (now: Date) =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

/** Allowances reset on the first day of each month at 00:00 UTC. */
export const resetsAt = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** "December 1". Always UTC, the clock allowances follow. */
export const formatDay = (iso: string) =>
  new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

const formatMonth = (period: string) =>
  new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(
    new Date(`${period}-01T00:00:00Z`),
  );

export const count = (value: number) => value.toLocaleString("en");

export const percentUsed = (usage: Pick<UsageDto, "used" | "limit">) =>
  usage.limit ? Math.floor((usage.used * 100) / usage.limit) : 0;

/**
 * When this month's pace reaches the limit, by a straight line from the start
 * of the month. Only once half is used and only if it lands before the reset:
 * earlier than that, a guess is not a reason.
 */
export function projectedReach(
  used: number,
  limit: number,
  now: Date,
): Date | null {
  if (used >= limit || used * 2 < limit) return null;
  const start = monthStart(now);
  const elapsed = now.getTime() - start;
  if (elapsed <= 0) return null;
  const reach = start + (elapsed * limit) / used;
  return reach < resetsAt(now).getTime() ? new Date(reach) : null;
}

/** Each a measurable reason, carried with the number that justifies it. */
export type UpgradeRecommendation = { metric: UsageMetric; limit: number } & (
  | { reason: "limit_reached" }
  | { reason: "projected"; used: number; days: number; reachesOn: string }
  | { reason: "near_months"; months: { period: string; used: number }[] }
);
export type UpgradeReason = UpgradeRecommendation["reason"];

/** Used counts of the months before this one, most recent first. */
export type UsageHistory = Record<
  UsageMetric,
  { period: string; used: number }[]
>;

const MONTHS_NEAR = 2;

function reasonFor(
  metric: UsageMetric,
  usage: UsageDto,
  history: UsageHistory[UsageMetric],
  now: Date,
): UpgradeRecommendation | null {
  const { used, limit } = usage;
  if (used >= limit) return { metric, limit, reason: "limit_reached" };
  const reach = projectedReach(used, limit, now);
  if (reach)
    return {
      metric,
      limit,
      reason: "projected",
      used,
      days: Math.max(1, Math.round((now.getTime() - monthStart(now)) / 864e5)),
      reachesOn: reach.toISOString(),
    };
  const months = history.slice(0, MONTHS_NEAR);
  const near = (item: { used: number }) =>
    item.used >= thresholdCount(limit, USAGE_WARNING_PERCENT);
  return months.length === MONTHS_NEAR && months.every(near)
    ? { metric, limit, reason: "near_months", months }
    : null;
}

/**
 * Pro only raises the allowance, so it is recommended only on Free and only
 * with a reason someone can check. Actions come before steps.
 */
export function recommendUpgrade(input: {
  plan: PlanKey;
  actions: UsageDto;
  steps: UsageDto;
  history: UsageHistory;
  now: Date;
}): UpgradeRecommendation | null {
  if (input.plan !== "free") return null;
  for (const metric of usageMetrics) {
    const found = reasonFor(
      metric,
      input[metric],
      input.history[metric],
      input.now,
    );
    if (found) return found;
  }
  return null;
}

export const proAllowance = (metric: UsageMetric) =>
  metric === "actions" ? plans.pro.intentsPerMonth : plans.pro.stepsPerMonth;

function evidence(item: UpgradeRecommendation) {
  const noun = metricNouns[item.metric];
  switch (item.reason) {
    case "limit_reached":
      return `This workspace has used all ${count(item.limit)} ${noun} this month.`;
    case "projected":
      return `At this month's pace (${count(item.used)} ${noun} in ${item.days} day${item.days === 1 ? "" : "s"}), this workspace will reach ${count(item.limit)} around ${formatDay(item.reachesOn)}.`;
    case "near_months":
      return `This workspace used more than ${USAGE_WARNING_PERCENT}% of its ${noun} in each of the last ${item.months.length} months (${item.months
        .map((month) => `${count(month.used)} in ${formatMonth(month.period)}`)
        .join(", ")}).`;
  }
}

/**
 * The reason, then what Pro changes and nothing more: the pricing page
 * promises the same policy controls on both plans.
 */
export const recommendationText = (item: UpgradeRecommendation) =>
  `${evidence(item)} Pro raises the allowance to ${count(proAllowance(item.metric))} ${metricNouns[item.metric]} a month for ${plans.pro.priceLabel.replace(" / ", " a ")}. Policy controls are the same on Free and Pro.`;
