import { describe, expect, test } from "vitest";
import type {
  NotificationPayload,
  UsageAlertPayload,
} from "@/contracts/v1/notifications";
import { receivesNotification } from "@/contracts/v1/notifications";
import {
  renderInvite,
  renderNotification,
} from "@/server/notifications/render";

const payload: NotificationPayload = {
  workspace: "Acme",
  environment: "Development",
  agent: "bot",
  subject: "bot-laptop",
  reference: null,
  path: "/app/acme/development/agents/bot",
  expiresAt: null,
};

describe("emails", () => {
  test("escape names chosen by people", () => {
    const { html } = renderNotification(
      "integration_stale",
      { ...payload, workspace: "A", agent: "<img src=x onerror=1>" },
      "https://x",
    );
    expect(html.match(/<img/g)).toHaveLength(1); // only the logo
    expect(html).toContain("&lt;img");
  });

  test("keep a subject on one line", () => {
    const { subject } = renderNotification(
      "integration_stale",
      { ...payload, workspace: "A\r\nBcc: victim@x.test" },
      "https://x",
    );
    expect(subject).not.toMatch(/[\r\n]/);
  });

  test("an invite escapes its names too", () => {
    const { html, subject } = renderInvite(
      { workspace: "<b>W</b>", invitedBy: "Ana\nEvil", role: "Viewer" },
      "https://x/invite/t",
    );
    expect(html).not.toContain("<b>W</b>");
    expect(subject).not.toContain("\n");
    expect(html).toContain('href="https://x/invite/t"');
  });
});

describe("who can receive what", () => {
  test.each([
    ["integrationStale", ["agents:manage"], true],
    ["integrationStale", ["policies:write"], true],
    ["integrationStale", ["workspace:read"], false],
    ["usageAlerts", ["workspace:settings"], true],
    ["usageAlerts", ["agents:manage", "policies:write"], false],
  ] as const)("%s with %j: %s", (preference, capabilities, expected) => {
    expect(receivesNotification(preference, [...capabilities])).toBe(expected);
  });
});

describe("usage alerts", () => {
  const alert: UsageAlertPayload = {
    workspace: "Acme",
    metric: "actions",
    threshold: 80,
    plan: "free",
    used: 800,
    limit: 1000,
    resetsAt: "2026-12-01T00:00:00.000Z",
    path: "/app/acme/settings/billing#billing-usage",
    recommendation: null,
    expiresAt: "2026-12-01T00:00:00.000Z",
  };
  const render = (overrides: Partial<UsageAlertPayload> = {}) =>
    renderNotification("usage_alert", { ...alert, ...overrides }, "https://x");

  test("at 80 %, the numbers, the reset and what 100 % means", () => {
    const { subject, text } = render();
    expect(subject).toBe(
      "You've used 80% of this month's agent actions in Acme",
    );
    expect(text).toContain("Acme has used 800 of its 1,000 agent actions");
    expect(text).toContain("resets on December 1 at 00:00 UTC");
    expect(text).toContain(
      "new agent actions are blocked until the reset on December 1. Nothing is charged automatically.",
    );
    expect(text).toContain(
      "See plan and usage: https://x/app/acme/settings/billing#billing-usage",
    );
    expect(text).toContain("turn these emails off under your account");
  });

  test("at 80 % on Free, Pro only with its reason", () => {
    const { text } = render({
      recommendation: {
        metric: "actions",
        limit: 1000,
        reason: "projected",
        used: 800,
        days: 10,
        reachesOn: "2026-11-13T12:00:00.000Z",
      },
    });
    expect(text).toContain("will reach 1,000 around November 13");
    expect(text).toContain("the same on Free and Pro");
  });

  test("at 100 % on Free: blocked until the reset, and the way to upgrade", () => {
    const { subject, text } = render({ threshold: 100, used: 1000 });
    expect(subject).toBe(
      "New agent actions in Acme are blocked until December 1",
    );
    expect(text).toContain("Upgrade from billing settings: https://x/app/");
    expect(text).not.toMatch(/safer|secure|protect/i);
  });

  test("at 100 % on Pro there is no plan above it, so a person to write to", () => {
    const { text } = render({
      threshold: 100,
      plan: "pro",
      used: 100_000,
      limit: 100_000,
    });
    expect(text).toContain("write to hello@nodrail.com");
    expect(text).not.toContain("Upgrade");
  });

  test("run steps: gates waiting for them stay closed", () => {
    const { subject, text } = render({ metric: "steps", threshold: 100 });
    expect(subject).toBe(
      "New run steps in Acme aren't recorded until December 1",
    );
    expect(text).toContain("gates waiting for them stay closed");
  });

  test("escape the workspace name in the page and the subject", () => {
    const { html, subject } = render({ workspace: "<b>A</b>\nBcc: x" });
    expect(html).not.toContain("<b>A</b>");
    expect(subject).not.toMatch(/[\r\n]/);
  });
});
