import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ActivityEventDto } from "@/contracts/v1/activity";
import type { HealthDto } from "@/contracts/v1/health";
import type { RunSummaryDto } from "@/contracts/v1/runs";
import { groupDecisions, groupTitle } from "./decisions";
import { HealthTiles } from "./health-tiles";
import { RecentDecisions } from "./recent-decisions";
import { ActiveRuns, HeldRuns, holdText } from "./runs";
import { TodayCounts } from "./today";

vi.mock("@/components/analytics/posthog", () => ({ track: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const base = "/app/acme/development";

let id = 0;
function decision(overrides: Partial<ActivityEventDto> = {}): ActivityEventDto {
  id += 1;
  return {
    id: `event-${id}`,
    occurredAt: new Date(Date.now() - id * 60_000).toISOString(),
    code: "denied_agent_paused",
    group: "decision",
    outcome: "denied",
    label: "Denied · agent paused",
    actor: { kind: "system", name: null },
    agentKey: "docs-helper",
    action: null,
    environment: "Development",
    rule: null,
    subject: null,
    detail: null,
    latestReport: null,
    ...overrides,
  };
}

const allowedByRule = (agentKey: string) =>
  decision({
    code: "allowed_by_rule",
    outcome: "allowed",
    label: "Allowed by rule",
    agentKey,
    rule: { kind: "rule", id: "r1", name: "Read issues", revision: 1 },
  });

describe("recent decisions", () => {
  test("repeats in a row fold into one group, order kept", () => {
    const events = [
      ...Array.from({ length: 5 }, () => decision()),
      allowedByRule("support"),
      decision(),
    ];
    const groups = groupDecisions(events);
    expect(groups.map((group) => group.events.length)).toEqual([5, 1, 1]);
    expect(groupTitle(groups[0]!)).toBe(
      "5 actions denied — docs-helper is paused",
    );
  });

  test("a different agent or reason starts a new group", () => {
    const groups = groupDecisions([
      allowedByRule("support"),
      allowedByRule("billing"),
      decision({
        ...allowedByRule("billing"),
        id: "other-rule",
        rule: { kind: "rule", id: "r2", name: "Write issues", revision: 1 },
      }),
    ]);
    expect(groups).toHaveLength(3);
  });

  test("stops at five rows, each group one row", () => {
    const events = Array.from({ length: 8 }, (_, index) =>
      allowedByRule(`agent-${index}`),
    );
    expect(groupDecisions(events)).toHaveLength(5);
  });

  test("a group opens to show each decision", () => {
    render(
      <RecentDecisions
        base={base}
        events={[decision(), decision(), allowedByRule("support")]}
      />,
    );
    const group = screen.getByText("2 actions denied — docs-helper is paused");
    expect(
      screen.getAllByRole("link", { name: /Allowed — rule Read issues/ }),
    ).toHaveLength(1);
    const details = group.closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(group);
    expect(details).toHaveAttribute("open");
    expect(
      within(details as HTMLElement).getAllByRole("link", {
        name: /Denied — docs-helper is paused/,
      }),
    ).toHaveLength(2);
  });

  test("with none, says so", () => {
    render(<RecentDecisions base={base} events={[]} />);
    expect(screen.getByText("No decisions recorded yet.")).toBeVisible();
  });
});

const run = (overrides: Partial<RunSummaryDto> = {}): RunSummaryDto => ({
  id: "run-1",
  key: "fix-login",
  installationName: "bot-dev",
  agentKey: "bot",
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  steps: 2,
  actions: 3,
  held: 1,
  agents: [],
  holding: {
    kind: "gate",
    name: "Review before the pull request",
    missing: [{ agent: "reviewer", verdicts: ["ship"], since: [] }],
  },
  status: "held",
  ...overrides,
});

describe("runs", () => {
  test("a held run says what it waits for", () => {
    render(<HeldRuns base={base} runs={[run()]} />);
    expect(screen.getByRole("link", { name: "fix-login" })).toHaveAttribute(
      "href",
      `${base}/activity/runs/run-1`,
    );
    expect(screen.getByText("waiting for reviewer")).toBeVisible();
    expect(
      holdText({
        kind: "gate",
        name: "g",
        missing: [
          { agent: "qa", verdicts: ["pass"], since: [] },
          { agent: "reviewer", verdicts: ["ship"], since: [] },
        ],
      }),
    ).toBe("waiting for qa and reviewer");
    expect(
      holdText({ kind: "budget", name: "Builder step", missing: [] }),
    ).toBe("Over budget · Builder step");
  });

  test("no held runs show nothing; no active runs say so", () => {
    const { container } = render(<HeldRuns base={base} runs={[]} />);
    expect(container).toBeEmptyDOMElement();
    render(<ActiveRuns base={base} runs={[]} />);
    expect(screen.getByText("No runs in the last 24 hours.")).toBeVisible();
  });
});

const healthy: HealthDto = {
  agents: { connected: 2, reporting: 2, paused: 0 },
  silent: [],
  paused: [],
  stalledSteps: [],
  uncovered: [],
  mismatched: [],
};

const usage = {
  actions: { used: 10, limit: 1000, state: "ok" as const },
  steps: { used: 0, limit: 1000, state: "ok" as const },
};

describe("health", () => {
  test("all well reads calm, and names who is silent or paused when not", () => {
    const { rerender } = render(
      <HealthTiles
        base={base}
        health={healthy}
        usage={usage}
        billingHref={null}
      />,
    );
    expect(
      screen.getByText("Every agent checked in within 30 minutes."),
    ).toBeVisible();
    expect(screen.getByText(/No silent agents or stalled steps/)).toBeVisible();
    rerender(
      <HealthTiles
        base={base}
        health={{
          ...healthy,
          agents: { connected: 4, reporting: 2, paused: 1 },
          silent: [
            { agentKey: "a", installationName: "a-dev", lastSeenAt: null },
            { agentKey: "b", installationName: "b-dev", lastSeenAt: null },
          ],
          paused: [{ agentKey: "docs", pausedAt: null, pausedBy: null }],
        }}
        usage={usage}
        billingHref={null}
      />,
    );
    const agents = screen.getByRole("link", { name: /Agents reporting/ });
    expect(agents).toHaveAttribute("href", `${base}/agents`);
    expect(agents).toHaveTextContent("2 of 4");
    expect(agents).toHaveTextContent("Silent: a, b");
    expect(agents).toHaveTextContent("Paused: docs");
    expect(agents).toHaveTextContent("no check-in in the last 30 minutes");
  });

  test("problems count silent agents and reports Nodrail never allowed", () => {
    const { container } = render(
      <HealthTiles
        base={base}
        health={{
          ...healthy,
          silent: [
            { agentKey: "a", installationName: "a-dev", lastSeenAt: null },
          ],
          paused: [{ agentKey: "docs", pausedAt: null, pausedBy: null }],
          mismatched: [
            {
              agentKey: "b",
              toolKey: "github",
              operationKey: "issues.delete",
              reportedAt: new Date().toISOString(),
            },
          ],
        }}
        usage={usage}
        billingHref={null}
      />,
    );
    const tile = container.querySelector('[data-tile="problems"]')!;
    expect(tile).toHaveTextContent("2 problems");
    expect(
      within(tile as HTMLElement).getByRole("link", {
        name: /Silent: a-dev, no check-in yet/,
      }),
    ).toHaveAttribute("href", `${base}/agents/a`);
    expect(
      within(tile as HTMLElement).getByRole("link", {
        name: /Report doesn't match decision: b, github.issues.delete/,
      }),
    ).toHaveAttribute("href", `${base}/activity?kind=mismatches`);
  });

  test("a little usage never reads as none", () => {
    const { container } = render(
      <HealthTiles
        base={base}
        health={healthy}
        usage={{ ...usage, actions: { ...usage.actions, used: 4 } }}
        billingHref={null}
      />,
    );
    const tile = container.querySelector('[data-tile="usage"]')!;
    expect(tile).toHaveTextContent("<1%");
    expect(tile).toHaveTextContent("Run steps (included)");
  });

  test("usage links to billing only for those who manage it, and warns at 80%", () => {
    const near = {
      ...usage,
      actions: { used: 850, limit: 1000, state: "near" as const },
    };
    const { rerender, container } = render(
      <HealthTiles
        base={base}
        health={healthy}
        usage={near}
        billingHref={null}
      />,
    );
    const tile = () =>
      container.querySelector('[data-tile="usage"]') as HTMLElement;
    expect(tile().tagName).toBe("DIV");
    expect(tile()).toHaveTextContent("Over 80%");
    rerender(
      <HealthTiles
        base={base}
        health={healthy}
        usage={near}
        billingHref="/app/acme/settings/billing"
      />,
    );
    expect(tile()).toHaveAttribute(
      "href",
      "/app/acme/settings/billing#billing-usage",
    );
  });
});

describe("today", () => {
  test("each count links to Activity filtered the same way", () => {
    const trend = { count: 3, days: [0, 1, 0, 0, 2, 0, 3] };
    render(
      <TodayCounts
        base={base}
        today={{ allowed: trend, denied: trend, held: trend }}
      />,
    );
    expect(screen.getByRole("link", { name: /^Allowed/ })).toHaveAttribute(
      "href",
      `${base}/activity?outcome=allowed&range=24h`,
    );
    expect(
      screen.getByRole("link", { name: /^Denied by a gate or budget/ }),
    ).toHaveTextContent(/held: 3 in the last 24 hours, 0 1 day ago/);
    expect(screen.queryByText(/waiting/i)).toBeNull();
  });
});
