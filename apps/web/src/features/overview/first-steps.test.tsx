import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FirstStepsDto, GuidanceDto } from "@/contracts/v1/guidance";
import { GuidanceProvider } from "@/features/guidance/components/guidance-provider";
import { FirstSteps, FirstStepsTracker } from "./first-steps";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  track: vi.fn(),
  mark: vi.fn(() => Promise.resolve({ status: "ok" as const })),
}));

vi.mock("@/components/analytics/posthog", () => ({ track: mocks.track }));
vi.mock("@/features/guidance/actions", () => ({
  markGuidanceAction: mocks.mark,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

const workspaceId = "6f1c3c1e-6c55-4c9b-9a65-0d1f0c5b8a10";
const none: FirstStepsDto = {
  agent: false,
  rule: false,
  decision: false,
  teammate: false,
};

function renderSteps(
  steps: FirstStepsDto,
  { checkedIn = true, initial = {} as GuidanceDto } = {},
) {
  const view = (current: FirstStepsDto) => (
    <GuidanceProvider initial={initial}>
      <FirstStepsTracker workspaceId={workspaceId} steps={current} />
      <FirstSteps
        base="/app/acme/development"
        workspaceBase="/app/acme"
        environmentId={workspaceId}
        steps={current}
        checkedIn={checkedIn}
      />
    </GuidanceProvider>
  );
  const result = render(view(steps));
  return { rerender: (next: FirstStepsDto) => result.rerender(view(next)) };
}

const step = (key: string) =>
  document.querySelector<HTMLElement>(
    `[data-slot=first-step][data-step=${key}]`,
  )!;

beforeEach(() => {
  mocks.track.mockReset();
  mocks.mark.mockClear();
  mocks.refresh.mockReset();
});

describe("first steps", () => {
  test("a new workspace starts at connecting an agent, with no way to hide them", () => {
    renderSteps(none, { checkedIn: false });
    expect(screen.getByText("0 of 3 done")).toBeVisible();
    expect(step("agent")).toHaveAttribute("aria-current", "step");
    expect(
      within(step("agent")).getByRole("link", { name: "Connect a project" }),
    ).toHaveAttribute("href", "/app/acme/development/agents/connect");
    expect(within(step("rule")).getByRole("link")).toHaveAttribute(
      "href",
      "/app/acme/development/policies",
    );
    expect(
      screen.getByRole("link", { name: "Invite a teammate" }),
    ).toHaveAttribute("href", "/app/acme/settings/members");
    // Setting up is optional: the list can be hidden before any step is done.
    expect(
      screen.getByRole("button", { name: "Hide these steps" }),
    ).toBeEnabled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("tick themselves from the data, and report each step once", () => {
    const { rerender } = renderSteps(none);
    rerender({ ...none, agent: true });
    expect(screen.getByText("1 of 3 done")).toBeVisible();
    expect(step("agent")).toHaveAttribute("data-done");
    expect(step("rule")).toHaveAttribute("aria-current", "step");
    expect(mocks.track).toHaveBeenCalledWith("checklist_item_done", {
      item: "agent",
    });

    rerender({ ...none, agent: true, rule: true });
    expect(screen.getByText("2 of 3 done")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      String((2 / 3) * 100),
    );
    expect(
      mocks.track.mock.calls.filter(([, props]) => props.item === "agent"),
    ).toHaveLength(1);
    expect(mocks.mark).toHaveBeenCalledWith({
      key: `checklist:${workspaceId}:rule`,
      value: null,
    });
  });

  test("a step seen done before is not reported again", () => {
    renderSteps(
      { ...none, agent: true },
      { initial: { [`checklist:${workspaceId}:agent`]: null } },
    );
    expect(mocks.track).not.toHaveBeenCalled();
  });

  test("say an agent still has to check in", () => {
    renderSteps({ ...none, agent: true }, { checkedIn: false });
    expect(step("agent")).toHaveTextContent("first check-in");
    expect(within(step("agent")).getByRole("link")).toHaveAttribute(
      "href",
      "/app/acme/development/agents",
    );
  });

  test("can be hidden for good once an agent is connected", async () => {
    renderSteps({ ...none, agent: true });
    await userEvent.click(
      screen.getByRole("button", { name: "Hide these steps" }),
    );
    expect(document.querySelector("[data-slot=first-steps]")).toBeNull();
    expect(mocks.mark).toHaveBeenCalledWith({
      key: `checklist-env:${workspaceId}`,
      value: null,
    });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  test("stay hidden once set aside", () => {
    renderSteps(
      { ...none, agent: true },
      { initial: { [`checklist-env:${workspaceId}`]: null } },
    );
    expect(document.querySelector("[data-slot=first-steps]")).toBeNull();
  });
});
