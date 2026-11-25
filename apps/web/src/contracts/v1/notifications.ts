import type { Capability } from "./access";
import type { PlanKey } from "./billing";
import type {
  UpgradeRecommendation,
  UsageMetric,
  UsageThreshold,
} from "./usage-alerts";

export type NotificationPreference = "integrationStale" | "usageAlerts";

/** Who a notification is useful to: someone able to act on it. */
export const notificationAudience: Record<
  NotificationPreference,
  readonly Capability[]
> = {
  integrationStale: ["policies:write", "agents:manage"],
  // Whoever manages billing: admins, the owner among them.
  usageAlerts: ["workspace:settings"],
};

export const receivesNotification = (
  preference: NotificationPreference,
  capabilities: readonly Capability[],
) =>
  notificationAudience[preference].some((item) => capabilities.includes(item));

export type AgentNotificationKind = "integration_stale";
export type NotificationKind = AgentNotificationKind | "usage_alert";

/**
 * Written to the outbox and into email, so it holds names and labels only. The
 * resource and parameters an agent supplied stay inside the app, behind sign-in.
 */
export type NotificationPayload = {
  workspace: string;
  environment: string;
  agent: string;
  /** The installation name of a stale integration. */
  subject: string;
  reference: string | null;
  path: string;
  /** After this moment there is nothing left to act on. */
  expiresAt: string | null;
};

/** A workspace reached a share of a monthly allowance. Numbers and names only. */
export type UsageAlertPayload = {
  workspace: string;
  metric: UsageMetric;
  threshold: UsageThreshold;
  plan: PlanKey;
  used: number;
  limit: number;
  resetsAt: string;
  /** Billing settings, where the plan and its usage are. */
  path: string;
  /** Free at 80 % only, measured when the alert was queued. */
  recommendation: UpgradeRecommendation | null;
  /** Once the allowance resets there is nothing left to warn about. */
  expiresAt: string;
};

export type NotificationPayloads = {
  [Kind in AgentNotificationKind]: NotificationPayload;
} & { usage_alert: UsageAlertPayload };
