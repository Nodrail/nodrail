import "server-only";
import { site } from "@nodrail/web-shared/site";
import { brandedEmail } from "./email-layout";
import type {
  AgentNotificationKind,
  NotificationKind,
  NotificationPayload,
  NotificationPayloads,
  UsageAlertPayload,
} from "@/contracts/v1/notifications";
import { plans } from "@/contracts/v1/billing";
import {
  count,
  formatDay,
  metricNouns,
  proAllowance,
  recommendationText,
} from "@/contracts/v1/usage-alerts";

export type RenderedEmail = { subject: string; text: string; html: string };

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

/** Names are chosen by people, so they cannot be trusted in a header. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

function email(
  subject: string,
  paragraphs: string[],
  action: { label: string; url: string },
  footnote?: string,
): RenderedEmail {
  return {
    subject: oneLine(subject),
    text: [
      ...paragraphs,
      `${action.label}: ${action.url}`,
      ...(footnote ? [footnote] : []),
    ].join("\n\n"),
    html: brandedEmail({
      heading: escapeHtml(oneLine(subject).replace(/^\[[^\]]*\]\s*/, "")),
      paragraphs: paragraphs.map(escapeHtml),
      action: { label: escapeHtml(action.label), href: escapeHtml(action.url) },
      footnote: footnote ? escapeHtml(footnote) : undefined,
    }),
  };
}

/** Links open the app. Nothing in an email can allow or deny anything. */
export function renderNotification<Kind extends NotificationKind>(
  kind: Kind,
  payload: NotificationPayloads[Kind],
  origin: string,
): RenderedEmail {
  // The kind decides the payload's shape; TypeScript can't narrow both at once.
  return kind === "usage_alert"
    ? renderUsageAlert(payload as UsageAlertPayload, origin)
    : renderAgentNotice(
        kind as AgentNotificationKind,
        payload as NotificationPayload,
        origin,
      );
}

function renderAgentNotice(
  kind: AgentNotificationKind,
  payload: NotificationPayload,
  origin: string,
): RenderedEmail {
  const { workspace, agent, subject } = payload;
  const url = `${origin}${payload.path}`;
  switch (kind) {
    case "integration_stale":
      return email(
        `[${workspace}] ${agent} stopped reporting`,
        [
          `The integration ${subject} in ${payload.environment} has missed its check-ins. Actions it should be governing may not be reaching Nodrail.`,
        ],
        { label: "Open the agent", url },
      );
  }
}

const blockedAt = {
  actions: (limit: string, day: string) =>
    `At ${limit}, new agent actions are blocked until the reset on ${day}. Nothing is charged automatically.`,
  steps: (limit: string, day: string) =>
    `At ${limit}, new run steps aren't recorded until the reset on ${day}, so gates waiting for them stay closed. Steps already recorded are not affected, and run steps are never charged.`,
};

const blockedNow = {
  actions: (day: string) =>
    `New agent actions are blocked until the allowance resets on ${day} at 00:00 UTC. Nothing is charged automatically.`,
  steps: (day: string) =>
    `New run steps aren't recorded until the allowance resets on ${day} at 00:00 UTC, so gates waiting for them stay closed. Steps already recorded are not affected, and nothing is charged automatically.`,
};

function usageParagraphs(alert: UsageAlertPayload) {
  const noun = metricNouns[alert.metric];
  const day = formatDay(alert.resetsAt);
  const limit = count(alert.limit);
  const plan = plans[alert.plan].label;
  if (alert.threshold !== 100)
    return [
      `${alert.workspace} has used ${count(alert.used)} of its ${limit} ${noun} this month on the ${plan} plan. The count resets on ${day} at 00:00 UTC.`,
      blockedAt[alert.metric](limit, day),
      ...(alert.recommendation
        ? [recommendationText(alert.recommendation)]
        : []),
    ];
  const pro = plans.pro.label;
  return [
    `${alert.workspace} has used all ${limit} ${noun} this month on the ${plan} plan.`,
    blockedNow[alert.metric](day),
    alert.plan === "free"
      ? `To continue before then, the workspace owner can upgrade to ${pro} (${plans.pro.priceLabel}) from billing settings. ${pro} raises the allowance to ${count(proAllowance(alert.metric))} ${noun} a month; policy controls are the same on Free and ${pro}.`
      : `${pro} is the largest plan. If this workspace needs more each month, write to ${site.contactEmail}.`,
  ];
}

/** Only ever sent to people who manage billing for the workspace. */
function renderUsageAlert(
  alert: UsageAlertPayload,
  origin: string,
): RenderedEmail {
  const noun = metricNouns[alert.metric];
  const day = formatDay(alert.resetsAt);
  const subject =
    alert.threshold !== 100
      ? `You've used ${alert.threshold}% of this month's ${noun} in ${alert.workspace}`
      : alert.metric === "actions"
        ? `New agent actions in ${alert.workspace} are blocked until ${day}`
        : `New run steps in ${alert.workspace} aren't recorded until ${day}`;
  const upgrade = alert.threshold === 100 && alert.plan === "free";
  return email(
    subject,
    usageParagraphs(alert),
    {
      label: upgrade ? "Upgrade from billing settings" : "See plan and usage",
      url: `${origin}${alert.path}`,
    },
    `You get this because you manage billing for ${alert.workspace}. You can turn these emails off under your account, in Notifications.`,
  );
}

export function renderInvite(
  invite: {
    workspace: string;
    invitedBy: string;
    role: string;
  },
  url: string,
): RenderedEmail {
  return email(
    `${invite.invitedBy} invited you to ${invite.workspace} on Nodrail`,
    [
      `${invite.invitedBy} invited you to join ${invite.workspace} as ${invite.role}.`,
      "This link works once, expires in a week, and only for this email address.",
    ],
    { label: "Join the workspace", url },
  );
}
