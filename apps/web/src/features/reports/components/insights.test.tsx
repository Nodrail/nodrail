import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type {
  DecisionMetricsDto,
  RuleMetricsDto,
} from "@/contracts/v1/insights";
import { medianLabel, percent, shareLabel, spendLabel } from "../presentation";
import {
  DecisionsGlance,
  RulesInsight,
  matchedSummary,
} from "./decision-insights";

describe("numbers in words", () => {
  test("spend shows dollars to the cent and tokens compactly", () => {
    expect(spendLabel({ usd: 0, tokens: 0 })).toBe("None");
    expect(spendLabel({ usd: 1.8, tokens: 41_000 })).toBe("$1.80 · 41K tokens");
    expect(spendLabel({ usd: 0, tokens: 1_250_000 })).toBe("1.3M tokens");
    expect(spendLabel({ usd: 12, tokens: 0 })).toBe("$12.00");
  });

  test("shares never divide by zero", () => {
    expect(percent({ count: 0, of: 0 })).toBe(0);
    expect(percent({ count: 1, of: 3 })).toBe(33);
    expect(shareLabel({ count: 0, of: 0 })).toBe("0 of 0");
    expect(shareLabel({ count: 2, of: 8 })).toBe("2 of 8 (25%)");
    expect(medianLabel(null)).toBe("None");
    expect(medianLabel(3.25)).toBe("3.3");
  });
});

const noDecisions: DecisionMetricsDto = {
  actions: 0,
  allowed: 0,
  denied: 0,
  noRule: 0,
};

const region = () =>
  screen.getByRole("region", { name: "What did the rules decide?" });

describe("decisions at a glance", () => {
  test("an empty window says so, and links to the denied actions", () => {
    render(<DecisionsGlance metrics={noDecisions} days={7} base="/app/a/b" />);
    expect(region()).toHaveTextContent("No actions in the last 7 days");
    expect(
      within(region()).getByRole("link", { name: "Open denied actions" }),
    ).toHaveAttribute("href", "/app/a/b/activity?outcome=denied");
  });

  test("counts read as plain figures, and nothing waits for a person", () => {
    render(
      <DecisionsGlance
        metrics={{ actions: 8, allowed: 5, denied: 3, noRule: 2 }}
        days={30}
        base="/app/a/b"
      />,
    );
    expect(region()).toHaveTextContent("Decided by a rule75%");
    expect(region()).toHaveTextContent("6 of 8 actions");
    expect(region()).toHaveTextContent("Allowed5");
    expect(region()).toHaveTextContent("No rule covers them2");
    expect(region()).not.toHaveTextContent(/approv|waiting|person decided/i);
  });
});

const noRules: RuleMetricsDto = {
  top: [],
  unused: [],
  newer: 0,
  activeRules: 0,
  decided: { count: 0, of: 0 },
};

describe("rules matched", () => {
  const usage = (matches: number) => ({
    logicalRuleId: `rule-${matches}`,
    name: `Rule ${matches}`,
    effect: "allow" as const,
    matches,
    lastMatchedAt: null,
  });

  test("rules too new to judge are counted apart, never as matched", () => {
    render(
      <RulesInsight
        metrics={{
          ...noRules,
          activeRules: 4,
          newer: 2,
          top: [usage(1), usage(3)],
          decided: { count: 4, of: 4 },
        }}
        days={30}
        base="/app/a/b"
      />,
    );
    expect(
      screen.getByText("2 rules matched; 2 are too new to judge."),
    ).toBeVisible();
    expect(screen.getByText("1 action")).toBeVisible();
    expect(screen.getByText("3 actions")).toBeVisible();
    expect(
      screen.getByText("2 rules newer than 30 days not judged"),
    ).toBeVisible();
  });

  test("with every rule old enough, all matched says so", () => {
    expect(
      matchedSummary({ ...noRules, activeRules: 3, top: [usage(1)] }),
    ).toBe("All 3 rules matched.");
  });
});

describe("rules", () => {
  test("no rules at all points at adding one", () => {
    render(<RulesInsight metrics={noRules} days={30} base="/app/a/b" />);
    expect(screen.getByText(/No rules yet/)).toBeVisible();
  });

  test("an unused rule links to itself as a candidate to remove", () => {
    render(
      <RulesInsight
        metrics={{
          ...noRules,
          activeRules: 1,
          unused: [
            {
              logicalRuleId: "rule-1",
              name: "Old rule",
              effect: "allow",
              matches: 0,
              lastMatchedAt: null,
            },
          ],
        }}
        days={30}
        base="/app/a/b"
      />,
    );
    expect(
      screen.getByText(/No rule matched in the last 30 days/),
    ).toBeVisible();
    const table = screen.getByRole("table", {
      name: "Rules that never matched",
    });
    expect(
      within(table).getByRole("link", { name: "Review rule" }),
    ).toHaveAttribute("href", "/app/a/b/policies/rule-1");
  });
});
