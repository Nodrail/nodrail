import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { ContractEventDto } from "@/contracts/v1/contract-events";
import { authoritativeEvent } from "../../../../tests/support/contract-fixtures";
import { eventState } from "../presentation";
import { ExchangeList } from "./exchange-list";

// Briefs, inputs and results read with the receipt's states:
// invalid, missing, unsupported and redacted stay apart, and a result's
// provider outcome never reads as undone.

const exchange = (overrides: Partial<ContractEventDto>) =>
  authoritativeEvent({
    verdict: null,
    findingsCount: null,
    fields: {},
    redacted: ["api_key"],
    absent: [],
    ...overrides,
  });

describe("each exchange state reads as itself", () => {
  test.each<[string, Partial<ContractEventDto>, string]>([
    ["a valid brief", { surface: "brief" }, "Valid brief"],
    [
      "an invalid brief",
      {
        surface: "brief",
        validation: "invalid",
        issues: [{ path: "scope", code: "enum" }],
        issueCount: 1,
      },
      "Invalid brief · dispatch blocked",
    ],
    [
      "an unobserved input",
      { surface: "tool_input", capture: "missing", validation: null },
      "Input not observed · provider not called",
    ],
    [
      "an input the host can't capture",
      { surface: "tool_input", capture: "unsupported", validation: null },
      "Host can't capture this input",
    ],
    [
      "a result the provider produced but that doesn't conform",
      {
        surface: "tool_result",
        validation: "invalid",
        execution: "succeeded",
        delivered: false,
      },
      "Provider ran; result unusable",
    ],
    [
      "a call that wasn't made",
      {
        surface: "tool_result",
        capture: "missing",
        validation: null,
        execution: "not-called",
      },
      "Provider not called",
    ],
    [
      "a result that isn't intercepted",
      { surface: "tool_result", capture: "unsupported", validation: null },
      "Result not intercepted",
    ],
    [
      "a valid result held back",
      { surface: "tool_result", execution: "succeeded", delivered: false },
      "Valid result · not delivered",
    ],
  ])("%s", (_, overrides, label) => {
    expect(eventState(exchange(overrides)).label).toBe(label);
  });

  test("no state says a side effect was undone", () => {
    for (const execution of ["succeeded", "failed", "unknown"] as const)
      expect(
        eventState(
          exchange({
            surface: "tool_result",
            validation: "invalid",
            execution,
          }),
        ).label,
      ).not.toMatch(/undone|rolled back|reverted/i);
  });
});

describe("exchange list", () => {
  test("each exchange opens to its fields, a secret only as redacted", () => {
    render(
      <ExchangeList
        events={[
          exchange({
            id: "a",
            surface: "tool_input",
            fields: { amount: 120 },
          }),
          exchange({
            id: "b",
            surface: "tool_result",
            execution: "succeeded",
            delivered: true,
            redacted: ["id"],
            fields: { status: "refunded" },
          }),
        ]}
      />,
    );
    expect(screen.getByText("Input: Valid input")).toBeTruthy();
    expect(screen.getByText("Result: Valid result")).toBeTruthy();
    expect(screen.getByText("Ran and succeeded")).toBeTruthy();
    expect(screen.getByText("Handed on")).toBeTruthy();
    const input = document.querySelector("[data-surface=tool_input]")!;
    expect(input.textContent).toContain("api_key");
    expect(input.textContent).toContain("Redacted · not reported");
  });

  test("nothing to show renders nothing", () => {
    const { container } = render(<ExchangeList events={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
