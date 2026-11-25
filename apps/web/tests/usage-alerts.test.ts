import { describe, expect, test } from "vitest";
import { usageFrom } from "@/contracts/v1/billing";
import {
  crossedAt,
  projectedReach,
  recommendUpgrade,
  recommendationText,
  resetsAt,
  type UsageHistory,
  type UsageNoticeDto,
} from "@/contracts/v1/usage-alerts";
import { usageBanner } from "@/features/shell/usage-banner";

const at = (iso: string) => new Date(iso);
const none: UsageHistory = { actions: [], steps: [] };

describe("thresholds", () => {
  test.each([
    [799, 1000, undefined],
    [800, 1000, 80],
    [801, 1000, undefined],
    [1000, 1000, 100],
    [80_000, 100_000, 80],
    [100_000, 100_000, 100],
    [800, 100_000, undefined],
  ])("%i of %i crosses %s", (count, limit, expected) => {
    expect(crossedAt(count, limit)).toBe(expected);
  });

  test("allowances reset on the first of next month, UTC", () => {
    expect(resetsAt(at("2026-11-30T23:59:59Z")).toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    expect(resetsAt(at("2026-12-15T10:00:00Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

describe("the month's pace", () => {
  test("a straight line from the first of the month", () => {
    // 600 in 10 days: 1,000 after 16 days and 16 hours.
    const reach = projectedReach(600, 1000, at("2026-11-11T00:00:00Z"));
    expect(reach?.toISOString()).toBe("2026-11-17T16:00:00.000Z");
  });

  test("says nothing under half the allowance", () => {
    expect(projectedReach(499, 1000, at("2026-11-02T00:00:00Z"))).toBeNull();
  });

  test("says nothing when the pace lands after the reset", () => {
    expect(projectedReach(600, 1000, at("2026-11-25T00:00:00Z"))).toBeNull();
  });

  test("says nothing once the allowance is used", () => {
    expect(projectedReach(1000, 1000, at("2026-11-05T00:00:00Z"))).toBeNull();
  });
});

describe("recommending Pro", () => {
  const free = (actions: number, steps = 0, history = none) => ({
    plan: "free" as const,
    actions: usageFrom(actions, 1000),
    steps: usageFrom(steps, 1000),
    history,
    now: at("2026-11-11T00:00:00Z"),
  });

  test("never on Pro", () => {
    expect(
      recommendUpgrade({
        ...free(0),
        plan: "pro",
        actions: usageFrom(100_000, 100_000),
      }),
    ).toBeNull();
  });

  test("never without a reason", () => {
    expect(recommendUpgrade(free(300))).toBeNull();
  });

  test("on pace to run out, with the numbers", () => {
    const item = recommendUpgrade(free(600));
    expect(item).toMatchObject({ reason: "projected", used: 600, days: 10 });
    expect(recommendationText(item!)).toContain(
      "At this month's pace (600 agent actions in 10 days), this workspace will reach 1,000 around November 17.",
    );
  });

  test("after two months above 80 %", () => {
    const history: UsageHistory = {
      actions: [
        { period: "2026-10", used: 912 },
        { period: "2026-09", used: 845 },
      ],
      steps: [],
    };
    const item = recommendUpgrade(free(100, 0, history));
    expect(item?.reason).toBe("near_months");
    expect(recommendationText(item!)).toContain(
      "more than 80% of its agent actions in each of the last 2 months (912 in October, 845 in September)",
    );
  });

  test("one month above 80 % is not a pattern", () => {
    const history: UsageHistory = {
      actions: [
        { period: "2026-10", used: 912 },
        { period: "2026-09", used: 200 },
      ],
      steps: [],
    };
    expect(recommendUpgrade(free(100, 0, history))).toBeNull();
  });

  test("run steps count too, and are named as steps", () => {
    const item = recommendUpgrade(free(0, 1000));
    expect(item).toMatchObject({ reason: "limit_reached", metric: "steps" });
    expect(recommendationText(item!)).toContain("all 1,000 run steps");
  });

  test("only ever promises a larger allowance", () => {
    const text = recommendationText(recommendUpgrade(free(1000))!);
    expect(text).toContain("Pro raises the allowance to 100,000");
    expect(text).toContain("the same on Free and Pro");
    expect(text).not.toMatch(/safer|secure|protect|more control/i);
  });
});

describe("the usage banner", () => {
  const notice = (
    actions: number,
    steps = 0,
    plan: "free" | "pro" = "free",
  ): UsageNoticeDto => {
    const limit = plan === "free" ? 1000 : 100_000;
    return {
      plan,
      period: "2026-11",
      resetsAt: "2026-12-01T00:00:00.000Z",
      actions: usageFrom(actions, limit),
      steps: usageFrom(steps, limit),
      deployment: "cloud",
    };
  };
  const manager = {
    canManageBilling: true,
    billingHref: "/app/acme/settings/billing",
    personId: "u1",
    workspaceId: "w1",
  };
  const member = { ...manager, canManageBilling: false };

  test("nothing below 80 %", () => {
    expect(usageBanner(notice(799, 799), manager)).toBeNull();
  });

  test("at 80 %, a warning with the numbers and the way to upgrade", () => {
    expect(usageBanner(notice(812), manager)).toEqual({
      metric: "actions",
      threshold: 80,
      tone: "warning",
      message:
        "812 of 1,000 agent actions used this month (81%). At 1,000, new agent actions are blocked until the reset on December 1.",
      action: {
        label: "Upgrade",
        href: "/app/acme/settings/billing#billing-usage",
      },
      dismissKey: "nodrail.usage-banner.u1.w1.2026-11.actions.80",
    });
  });

  test("at 100 %, danger; Pro is pointed at a person, not a plan", () => {
    const state = usageBanner(notice(100_000, 0, "pro"), manager);
    expect(state).toMatchObject({ tone: "danger", threshold: 100 });
    expect(state?.message).toContain("blocked until December 1");
    expect(state?.action).toEqual({
      label: "Contact us",
      href: "mailto:hello@nodrail.com",
    });
  });

  test("reached comes before near, actions before steps", () => {
    expect(usageBanner(notice(850, 1000), manager)).toMatchObject({
      metric: "steps",
      threshold: 100,
    });
    expect(usageBanner(notice(850, 900), manager)).toMatchObject({
      metric: "actions",
      threshold: 80,
    });
  });

  test("someone who can't manage billing hears only of a pause", () => {
    expect(usageBanner(notice(900), member)).toBeNull();
    expect(usageBanner(notice(1000), member)).toEqual({
      metric: "actions",
      threshold: 100,
      tone: "info",
      message:
        "New agent actions are paused until December 1; ask your workspace owner.",
      action: null,
      dismissKey: "nodrail.usage-banner.u1.w1.2026-11.actions.100",
    });
    expect(usageBanner(notice(0, 1000), member)?.message).toBe(
      "New run steps aren't recorded until December 1; ask your workspace owner.",
    );
  });
});
