import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { usageFrom, type BillingDto } from "@/contracts/v1/billing";
import { BillingCard } from "./billing-card";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/posthog", () => ({ track }));
vi.mock("../actions", () => ({
  startCheckoutAction: vi.fn(),
  openBillingPortalAction: vi.fn(),
}));

const billing: BillingDto = {
  plan: "free",
  deployment: "cloud",
  usage: usageFrom(620, 1000),
  steps: usageFrom(0, 1000),
  resetsAt: "2026-12-01T00:00:00.000Z",
  recommendation: null,
  renewsOrEndsAt: null,
  cancelAtPeriodEnd: false,
  paymentFailedUntil: null,
  canManage: true,
  available: true,
  hasCustomer: false,
};

const show = (overrides: Partial<BillingDto> = {}) =>
  render(
    <BillingCard workspace="acme" billing={{ ...billing, ...overrides }} />,
  );

describe("BillingCard", () => {
  beforeEach(() => track.mockReset());

  test("says when usage resets", () => {
    show();
    expect(screen.getByText("December 1, 00:00 UTC")).toBeVisible();
  });

  test("says what happens at the limit, whatever the usage", () => {
    show();
    expect(
      screen.getByText(/^At the limit, new agent actions are blocked/),
    ).toBeVisible();
    expect(
      screen.getByText(/^At the limit, new run steps aren't recorded/),
    ).toBeVisible();
    expect(
      screen.getByText("0 of 1,000 run steps this month, included"),
    ).toBeVisible();
    show({ usage: usageFrom(1000, 1000) });
    expect(screen.getByRole("status")).toHaveTextContent(/^Allowance used/);
  });

  test("recommends Pro only with the number behind it", () => {
    show({
      recommendation: {
        metric: "actions",
        limit: 1000,
        reason: "projected",
        used: 620,
        days: 10,
        reachesOn: "2026-11-17T04:00:00.000Z",
      },
    });
    expect(
      screen.getByText(
        /At this month's pace \(620 agent actions in 10 days\), this workspace will reach 1,000 around November 17\./,
      ),
    ).toBeVisible();
    expect(track).toHaveBeenCalledWith("upgrade_recommendation_shown", {
      reason: "projected",
    });
  });

  test("without a reason, no recommendation", () => {
    show();
    expect(screen.queryByText(/Pro raises the allowance/)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });
});
