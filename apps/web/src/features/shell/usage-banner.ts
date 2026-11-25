import {
  count,
  formatDay,
  percentUsed,
  thresholdOf,
  usageMetrics,
  type UsageMetric,
  type UsageNoticeDto,
  type UsageThreshold,
} from "@/contracts/v1/usage-alerts";
import { plans } from "@/contracts/v1/billing";
import { site } from "@nodrail/web-shared/site";

export type UsageBannerTone = "warning" | "danger" | "info";

export type UsageBannerState = {
  metric: UsageMetric;
  threshold: UsageThreshold;
  tone: UsageBannerTone;
  message: string;
  action: { label: string; href: string } | null;
  /** Dismissing is remembered per person, workspace, month and threshold. */
  dismissKey: string;
};

const managerMessages: Record<
  UsageMetric,
  Record<UsageThreshold, (n: UsageNumbers) => string>
> = {
  actions: {
    80: (n) =>
      `${n.used} of ${n.limit} agent actions used this month (${n.percent}%). At ${n.limit}, new agent actions are blocked until the reset on ${n.day}.`,
    100: (n) =>
      `All ${n.limit} agent actions this month are used. New agent actions are blocked until ${n.day}.`,
  },
  steps: {
    80: (n) =>
      `${n.used} of ${n.limit} run steps recorded this month (${n.percent}%). At ${n.limit}, new steps aren't recorded until the reset on ${n.day}.`,
    100: (n) =>
      `All ${n.limit} run steps this month are used. New steps aren't recorded until ${n.day}, so gates waiting for them stay closed.`,
  },
};

const memberMessages: Record<UsageMetric, (n: UsageNumbers) => string> = {
  actions: (n) =>
    `New agent actions are paused until ${n.day}; ask your workspace owner.`,
  steps: (n) =>
    `New run steps aren't recorded until ${n.day}; ask your workspace owner.`,
};

type UsageNumbers = {
  used: string;
  limit: string;
  percent: number;
  day: string;
};

/** The one allowance worth a banner: reached before near, actions before steps. */
function worstAllowance(notice: UsageNoticeDto, canManageBilling: boolean) {
  const found = usageMetrics
    .map((metric) => ({ metric, threshold: thresholdOf(notice[metric]) }))
    .filter(
      (item): item is { metric: UsageMetric; threshold: UsageThreshold } =>
        item.threshold === 100 || (canManageBilling && item.threshold !== null),
    );
  return found.find((item) => item.threshold === 100) ?? found[0] ?? null;
}

/**
 * Who manages billing sees 80 % and 100 % with one way forward; everyone
 * else only learns that agents are paused, and whom to ask. Never a sales
 * pitch for anyone who can't act on it.
 */
export function usageBanner(
  notice: UsageNoticeDto,
  viewer: {
    canManageBilling: boolean;
    /** The workspace's billing page, where Upgrade leads. */
    billingHref: string;
    personId: string;
    workspaceId: string;
  },
): UsageBannerState | null {
  const worst = worstAllowance(notice, viewer.canManageBilling);
  if (!worst) return null;
  const { metric, threshold } = worst;
  const usage = notice[metric];
  const numbers = {
    used: count(usage.used),
    limit: count(usage.limit),
    percent: percentUsed(usage),
    day: formatDay(notice.resetsAt),
  };
  const dismissKey = `nodrail.usage-banner.${viewer.personId}.${viewer.workspaceId}.${notice.period}.${metric}.${threshold}`;
  if (!viewer.canManageBilling)
    return {
      metric,
      threshold,
      tone: "info",
      message: memberMessages[metric](numbers),
      action: null,
      dismissKey,
    };
  return {
    metric,
    threshold,
    tone: threshold === 100 ? "danger" : "warning",
    message: managerMessages[metric][threshold](numbers),
    // Self-hosted: no Cloud plan to buy; the limit is the operator's.
    action:
      notice.deployment === "self-hosted"
        ? null
        : notice.plan === "free"
          ? { label: "Upgrade", href: `${viewer.billingHref}#billing-usage` }
          : { label: "Contact us", href: `mailto:${site.contactEmail}` },
    dismissKey,
  };
}

/** The workspace menu's plan badge, and its usage for who manages billing. */
export type PlanHint = { plan: string; percent: number | null };

/** The fuller allowance's share used this month, as on the Overview tile. */
export function planHint(
  notice: UsageNoticeDto,
  canManageBilling: boolean,
): PlanHint {
  return {
    plan:
      notice.deployment === "self-hosted"
        ? "Self-hosted"
        : plans[notice.plan].label,
    percent: canManageBilling
      ? Math.max(...usageMetrics.map((metric) => percentUsed(notice[metric])))
      : null,
  };
}
