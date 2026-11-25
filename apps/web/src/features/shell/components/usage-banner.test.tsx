import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UsageBannerState } from "../usage-banner";
import { UsageBanner } from "./usage-banner";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/components/analytics/posthog", () => ({ track }));

const state: UsageBannerState = {
  metric: "actions",
  threshold: 80,
  tone: "warning",
  message: "812 of 1,000 agent actions used this month (81%).",
  action: { label: "Upgrade", href: "/app/acme/settings/billing" },
  dismissKey: "nodrail.usage-banner.u1.w1.2026-11.actions.80",
};

describe("UsageBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    track.mockReset();
  });

  test("shows the numbers and one way forward, once", async () => {
    const { rerender } = render(<UsageBanner state={state} />);
    expect(await screen.findByText(/812 of 1,000/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Upgrade" })).toHaveAttribute(
      "href",
      "/app/acme/settings/billing",
    );
    rerender(<UsageBanner state={{ ...state }} />);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("usage_banner_shown", {
      metric: "actions",
      threshold: 80,
    });
  });

  test("stays dismissed for that month and threshold only", async () => {
    const { unmount } = render(<UsageBanner state={state} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Dismiss this notice" }),
    );
    expect(screen.queryByText(/812 of 1,000/)).toBeNull();
    expect(track).toHaveBeenCalledWith("usage_banner_dismissed", {
      metric: "actions",
      threshold: 80,
    });
    unmount();

    render(<UsageBanner state={state} />);
    expect(screen.queryByText(/812 of 1,000/)).toBeNull();

    const reached: UsageBannerState = {
      ...state,
      threshold: 100,
      tone: "danger",
      message: "All 1,000 agent actions this month are used.",
      dismissKey: "nodrail.usage-banner.u1.w1.2026-11.actions.100",
    };
    render(<UsageBanner state={reached} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "All 1,000 agent actions",
    );
  });

  test("renders nothing without a notice", () => {
    const { container } = render(<UsageBanner state={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
