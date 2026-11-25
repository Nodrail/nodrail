import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ReportDto } from "@/contracts/v1/reports";
import { GatesInsight } from "./run-insights";

const share = { count: 1, of: 1 };
const report = {
  gates: [
    {
      id: "g1",
      name: "QA first",
      checked: 2,
      held: 1,
      firstPass: share,
      missing: [],
    },
  ],
  budgets: [],
  agents: [],
  checks: [],
  topRuns: [],
  runs: {
    count: 1,
    medianSteps: 1,
    withoutHold: share,
    reworkLoops: 0,
    withRework: 0,
    spend: { usd: 0, tokens: 0 },
  },
} satisfies ReportDto;

const show = (canImport: boolean) =>
  render(
    <GatesInsight
      report={report}
      days={7}
      base="/app/acme/development"
      canImport={canImport}
    />,
  );

describe("gates in Insights", () => {
  test("lead to the Gates tab, and each gate to its form", () => {
    show(true);
    expect(screen.getByRole("link", { name: "Open gates" })).toHaveAttribute(
      "href",
      "/app/acme/development/policies/gates",
    );
    expect(screen.getByRole("link", { name: "QA first" })).toHaveAttribute(
      "href",
      "/app/acme/development/policies/gates/g1/edit",
    );
  });

  test("name gates without a link for people who can't edit them", () => {
    show(false);
    expect(screen.getByText("QA first")).toBeVisible();
    expect(screen.queryByRole("link", { name: "QA first" })).toBeNull();
  });
});
