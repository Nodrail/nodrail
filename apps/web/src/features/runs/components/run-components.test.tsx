import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { requirementStatusText, type RunEntryDto } from "@/contracts/v1/runs";
import { gateHold } from "../../../../tests/support/hold-fixture";
import { RunHold } from "./run-hold";
import { RunTimeline } from "./run-timeline";

const hold = { ...gateHold, id: "gate-1" };

const step = {
  stepKey: "dev-1",
  agent: "dev",
  installationName: "Laptop",
  startedAt: "2026-11-01T10:00:00Z",
  finishedAt: "2026-11-01T10:05:00Z",
  verdict: "done",
  findings: [],
};

const entries: RunEntryDto[] = [
  { kind: "started", at: "2026-11-01T10:00:00Z", step },
  { kind: "finished", at: "2026-11-01T10:05:00Z", step },
  {
    kind: "action",
    at: "2026-11-01T10:06:00Z",
    action: {
      id: "action-1",
      at: "2026-11-01T10:06:00Z",
      stepKey: null,
      agent: "lead",
      toolKey: "claude-code",
      operationKey: "agent",
      resource: "github",
      evaluation: "denied",
      hold,
      eventId: "event-1",
    },
  },
];

describe("RunTimeline", () => {
  test("lists each entry with what was held and why", () => {
    render(
      <RunTimeline
        entries={entries}
        mainAgent="lead-agent"
        activityPath="/activity"
      />,
    );
    const timeline = screen.getByRole("list", { name: "Run timeline" });
    const items = timeline.querySelectorAll("[data-slot=run-entry]");
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveAttribute("data-kind", "action");
    const action = within(items[2] as HTMLElement);
    expect(
      action.getByText("the github agent", { exact: false }),
    ).toBeVisible();
    expect(action.getByText("Stopped")).toBeVisible();
    expect(
      action.getByText("Denied by gate · Review before the pull request", {
        exact: false,
      }),
    ).toBeVisible();
    expect(action.getByText("Denied: 1 of 2 requirements unmet")).toBeVisible();
    expect(
      action.getByText(
        "qa must report pass after the latest change and after any dev step",
      ),
    ).toBeVisible();
    expect(
      action.getByRole("link", { name: "View in Activity →" }),
    ).toHaveAttribute("href", "/activity?event=event-1");
    // Nothing waits for a person: no request to review.
    expect(action.queryByText(/review request|allowed once/i)).toBeNull();
  });

  test("the main agent is named", () => {
    const [entry] = entries.filter((item) => item.kind === "action");
    if (entry?.kind !== "action") throw new Error("fixture has an action");
    const action = { ...entry.action, agent: "main" };
    render(
      <RunTimeline
        entries={[{ ...entry, action }]}
        mainAgent="coder"
        activityPath="/activity"
      />,
    );
    expect(screen.getByText("coder")).toBeVisible();
    expect(screen.queryByText("main")).toBeNull();
  });

  test("an action with no event yet is found in Activity by its reference", () => {
    const [entry] = entries.filter((item) => item.kind === "action");
    if (entry?.kind !== "action") throw new Error("fixture has an action");
    render(
      <RunTimeline
        entries={[{ ...entry, action: { ...entry.action, eventId: null } }]}
        mainAgent={null}
        activityPath="/activity"
      />,
    );
    expect(
      screen.getByRole("link", { name: "View in Activity →" }),
    ).toHaveAttribute("href", expect.stringMatching(/^\/activity\?q=REQ-/));
  });

  test("a call decided on its host says so, with the policy's short digest", () => {
    const [entry] = entries.filter((item) => item.kind === "action");
    if (entry?.kind !== "action") throw new Error("fixture has an action");
    const digest = "0123456789ab".padEnd(64, "f");
    const { container } = render(
      <RunTimeline
        entries={[
          entry,
          {
            ...entry,
            action: {
              ...entry.action,
              id: "action-2",
              hold: null,
              evaluation: "ready",
              host: { policyDigest: digest, policySkew: true },
            },
          },
        ]}
        mainAgent={null}
        activityPath="/activity"
      />,
    );
    const badges = container.querySelectorAll("[data-slot=decided-on-host]");
    expect(badges).toHaveLength(1);
    const badge = within(badges[0] as HTMLElement);
    expect(badge.getByText("Decided on host")).toBeVisible();
    expect(badge.getByText("Policy skew")).toBeVisible();
    expect(badge.getByText("0123456789ab")).toBeVisible();
  });
});

describe("RunHold", () => {
  test("is a region named for the gate, with each requirement's status", () => {
    render(<RunHold hold={hold} run={{ key: "feat/x", href: "/runs/1" }} />);
    const region = screen.getByRole("region", {
      name: "Denied by gate · Review before the pull request",
    });
    expect(
      within(region).getByRole("link", { name: "feat/x" }),
    ).toHaveAttribute("href", "/runs/1");
    expect(region).toHaveTextContent("Denied: 1 of 2 requirements unmet");
    const lines = region.querySelectorAll("[data-slot=requirement-status]");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("data-state", "unmet");
    expect(lines[0]).toHaveTextContent(
      "✗Not met: qa reported fail (needs pass)",
    );
    expect(lines[1]).toHaveAttribute("data-state", "met");
    expect(lines[1]).toHaveTextContent("reviewer reported ship");
  });

  test("a hold kept before statuses lists what is missing", () => {
    const { requirements: _, ...older } = hold;
    render(<RunHold hold={older} run={null} />);
    const region = screen.getByRole("region");
    expect(region).toHaveTextContent("Denied: 1 requirement unmet");
    expect(region).toHaveTextContent(
      "qa must report pass after the latest change and after any dev step",
    );
  });

  test("explains a used-up budget in words", () => {
    render(
      <RunHold
        hold={{ ...hold, kind: "budget", name: "Builder step", missing: [] }}
        run={null}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Over budget · Builder step" }),
    ).toHaveTextContent("No run was declared");
    expect(screen.getByText("Missing qa.")).toBeVisible();
  });
});

describe("requirement status lines", () => {
  const base = { agent: "qa", verdicts: ["pass"], since: ["dev"] };
  test.each([
    [{ met: false, reported: null }, "qa hasn't reported (needs pass)"],
    [
      { met: false, reported: { verdict: "pass", at: "2026-11-01T10:00:00Z" } },
      "qa reported pass before the latest change (needs pass again)",
    ],
    [
      { met: false, reported: { verdict: null, at: "2026-11-01T10:00:00Z" } },
      "qa finished without a verdict (needs pass)",
    ],
  ])("%o reads %s", (status, text) => {
    expect(requirementStatusText({ ...base, ...status })).toBe(text);
  });
});
