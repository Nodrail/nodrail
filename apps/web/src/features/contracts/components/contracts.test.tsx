import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { explainRequirement } from "@/contracts/v1/contract-explain";
import { RunHold } from "@/features/runs/components/run-hold";
import {
  authoritativeEvent,
  receiptEvent,
  reviewer,
} from "../../../../tests/support/contract-fixtures";
import { gateHold } from "../../../../tests/support/hold-fixture";
import { ContractCheck } from "./contract-check";
import { ReceiptInspector } from "./receipt-inspector";

/** One declared field's row in the inspector. */
const fieldRow = (path: string) => {
  const fields = document.querySelector<HTMLElement>(
    "[data-slot=contract-fields]",
  )!;
  return within(fields).getByText(path).closest("div")!;
};

describe("receipt inspector", () => {
  test("a valid local receipt: verdict, producer, contract and each field's state", () => {
    render(<ReceiptInspector event={receiptEvent()} />);
    expect(screen.getByText("Valid · ship")).toBeTruthy();
    expect(
      screen.getByText(/^Agent-reported · Local enforcement/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /^reviewer-result · [0-9a-f]{12} · only the reported part/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/Checked on the machine; Cloud checked only/),
    ).toBeTruthy();
    expect(fieldRow("findings.blocker").dataset.state).toBe("value");
    expect(fieldRow("lesson").textContent).toContain("Not provided");
    for (const path of reviewer.projection.withheld) {
      expect(fieldRow(path).dataset.state).toBe("redacted");
      expect(fieldRow(path).textContent).toContain("Redacted · not reported");
    }
    expect(
      screen.getByText(/Local report: it can't satisfy a Cloud gate/),
    ).toBeTruthy();
  });

  test("an invalid receipt: issues by path and reason, with the true count", () => {
    render(
      <ReceiptInspector
        event={receiptEvent({
          validation: "invalid",
          verdict: null,
          findingsCount: null,
          fields: {},
          absent: [],
          issues: [
            { path: "findings.blocker", code: "type" },
            { path: null, code: "unknown" },
          ],
          issueCount: 5,
        })}
      />,
    );
    expect(screen.getByText("Invalid receipt")).toBeTruthy();
    const issues = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(issues).toEqual([
      "findings.blocker: wrong type",
      "a property that isn't reported: not declared",
      "and 3 more",
    ]);
  });

  test("missing and unsupported are told apart, and show no fields", () => {
    const uncaptured = (capture: "missing" | "unsupported") =>
      receiptEvent({
        capture,
        validation: null,
        validatedBy: null,
        projectionValidation: null,
        verdict: null,
        fields: {},
        redacted: [],
        absent: [],
      });
    const { rerender } = render(
      <ReceiptInspector event={uncaptured("missing")} />,
    );
    expect(screen.getByText("Finished without a receipt")).toBeTruthy();
    expect(screen.queryByText(/Redacted/)).toBeNull();
    rerender(<ReceiptInspector event={uncaptured("unsupported")} />);
    expect(screen.getByText("Host can't capture this receipt")).toBeTruthy();
  });

  test("values that didn't match the projection weren't kept", () => {
    render(
      <ReceiptInspector
        event={receiptEvent({ projectionValidation: "invalid", fields: {} })}
      />,
    );
    expect(screen.getByText(/so none were kept/)).toBeTruthy();
  });

  test("a receipt Cloud checked carries no local-report warning", () => {
    render(<ReceiptInspector event={authoritativeEvent()} />);
    expect(screen.getByText("Checked by Cloud")).toBeTruthy();
    expect(screen.queryByText(/can't satisfy a Cloud gate/)).toBeNull();
  });
});

describe("gate explanation", () => {
  const requirement = {
    agent: "reviewer",
    verdicts: null,
    where: [
      { path: ["findings", "blocker"], op: "eq" as const, value: 0 },
      { path: ["anchor"], op: "eq" as const, value: "fresh" },
    ],
    authority: "runtime-observed" as const,
    contractDigest: reviewer.contract,
    subjectRevision: null,
  };

  test("each condition with what it expects, what it saw, and the next step", () => {
    render(
      <ContractCheck
        check={explainRequirement(requirement, authoritativeEvent())}
      />,
    );
    const [blocker, anchor] = screen.getAllByRole("listitem");
    expect(blocker!.textContent).toBe("findings.blocker = 0 · has 0");
    expect(anchor!.textContent).toBe("anchor = fresh · has redacted");
    expect(
      screen.getByText(/isn't reported, so Cloud can't check it/),
    ).toBeTruthy();
  });

  test("a held gate shows the receipt reason under its requirement", () => {
    const check = explainRequirement(requirement, receiptEvent());
    render(
      <RunHold
        hold={{
          ...gateHold,
          id: "gate-1",
          requirements: [
            {
              ...gateHold.missing[0]!,
              met: false,
              reported: { verdict: "ship", at: "2026-11-21T10:00:00Z" },
              check,
            },
          ],
        }}
        run={null}
      />,
    );
    const explanation = document.querySelector("[data-slot=contract-check]")!;
    expect(explanation.getAttribute("data-reason")).toBe("reported_only");
    expect(explanation.textContent).toContain(
      "Local report: it can't satisfy a Cloud gate",
    );
  });
});
