// Gate explanations: every way a receipt requirement can be
// unmet has its own reason, the exact path, a redacted marker in place of a
// value Cloud never saw, and a next step; a contract revision mismatch never
// says "rerun".
import { describe, expect, test } from "vitest";
import {
  explainRequirement,
  explainRunShortfall,
  type ContractRequirement,
} from "@/contracts/v1/contract-explain";
import {
  authoritativeEvent,
  otherDigest,
  receiptEvent,
  reviewer,
} from "./support/contract-fixtures";

const requirement = (
  overrides: Partial<ContractRequirement> = {},
): ContractRequirement => ({
  agent: "reviewer",
  verdicts: ["ship", "ship-with-debt"],
  where: [{ path: ["findings", "blocker"], op: "eq", value: 0 }],
  authority: "runtime-observed",
  contractDigest: reviewer.contract,
  subjectRevision: "c".repeat(40),
  ...overrides,
});

describe("a receipt that meets the requirement", () => {
  test("is met, with each condition and what it saw", () => {
    const check = explainRequirement(requirement(), authoritativeEvent());
    expect(check).toMatchObject({ met: true, reason: "met", nextStep: null });
    expect(check.conditions).toEqual([
      {
        path: "findings.blocker",
        expected: "= 0",
        observed: { kind: "value", value: "0" },
        met: true,
      },
    ]);
  });
});

describe("each unmet reason is its own", () => {
  test.each([
    ["no_receipt", null],
    [
      "missing",
      authoritativeEvent({ capture: "missing", validation: null, fields: {} }),
    ],
    [
      "unsupported",
      authoritativeEvent({
        capture: "unsupported",
        validation: null,
        fields: {},
      }),
    ],
    [
      "contract_changed",
      authoritativeEvent({
        contract: {
          ...authoritativeEvent().contract,
          digest: otherDigest("d"),
        },
      }),
    ],
    [
      "invalid",
      authoritativeEvent({
        validation: "invalid",
        verdict: null,
        issues: [{ path: "findings.blocker", code: "type" }],
        issueCount: 1,
        authorizes: false,
      }),
    ],
    ["reported_only", receiptEvent()],
    [
      "stale_subject",
      authoritativeEvent({
        provenance: {
          ...(authoritativeEvent().provenance as Extract<
            ReturnType<typeof authoritativeEvent>["provenance"],
            { authority: "authoritative" }
          >),
          subject: { revision: "d".repeat(40), source: "runtime-observed" },
        },
      }),
    ],
    ["verdict", authoritativeEvent({ verdict: "fix-first" })],
    [
      "condition",
      authoritativeEvent({
        fields: { verdict: "ship", findings: { blocker: 2, major: 0 } },
      }),
    ],
  ] as const)("%s", (reason, event) => {
    const check = explainRequirement(requirement(), event);
    expect(check.met).toBe(false);
    expect(check.reason).toBe(reason);
    expect(check.nextStep).toBeTruthy();
  });

  test("a changed contract never asks for a rerun", () => {
    const check = explainRequirement(
      requirement({ contractDigest: otherDigest("d") }),
      authoritativeEvent(),
    );
    expect(check.reason).toBe("contract_changed");
    expect(check.nextStep).not.toMatch(/rerun/i);
  });

  test("an agent-reported receipt can't stand in for runtime-observed evidence", () => {
    const base = authoritativeEvent();
    const check = explainRequirement(
      requirement(),
      authoritativeEvent({
        provenance: {
          ...(base.provenance as Extract<
            typeof base.provenance,
            { authority: "authoritative" }
          >),
          producerClass: "agent-reported",
        },
      }),
    );
    expect(check.reason).toBe("authority");
    expect(check.nextStep).toMatch(/won't change who produced it/);
  });

  test("an invalid receipt shows its paths and codes, never values", () => {
    const check = explainRequirement(
      requirement(),
      authoritativeEvent({
        validation: "invalid",
        verdict: null,
        issues: [{ path: "findings.blocker", code: "type" }],
        issueCount: 1,
      }),
    );
    expect(check.issues).toEqual([{ path: "findings.blocker", code: "type" }]);
  });
});

describe("a condition on a value Cloud never saw", () => {
  test("shows a redacted marker and stays unmet", () => {
    const check = explainRequirement(
      requirement({
        verdicts: null,
        where: [{ path: ["anchor"], op: "eq", value: "fresh" }],
      }),
      authoritativeEvent(),
    );
    expect(check.reason).toBe("condition");
    expect(check.conditions[0]!.observed).toEqual({ kind: "redacted" });
    expect(check.summary).toBe(
      "Needs anchor = fresh; the receipt has a redacted value",
    );
  });

  test("a reported field left out is not provided, and satisfies nothing", () => {
    const check = explainRequirement(
      requirement({
        verdicts: null,
        where: [{ path: ["lesson"], op: "in", values: ["x"] }],
      }),
      authoritativeEvent(),
    );
    expect(check.conditions[0]).toMatchObject({
      observed: { kind: "not_provided" },
      met: false,
    });
  });

  test("ranges read as words", () => {
    const check = explainRequirement(
      requirement({
        verdicts: null,
        where: [
          { path: ["findings", "major"], op: "range", min: null, max: 0 },
        ],
      }),
      authoritativeEvent(),
    );
    expect(check.summary).toBe(
      "Needs findings.major at most 0; the receipt has 1",
    );
  });
});

describe("Cloud read the value, and only withholds it from view", () => {
  test("an unmet withheld condition asks for new work, not a contract change", () => {
    const check = explainRequirement(
      requirement({
        verdicts: null,
        where: [{ path: ["anchor"], op: "eq", value: "fresh" }],
      }),
      authoritativeEvent({
        fields: { ...authoritativeEvent().fields, anchor: "stale" },
      }),
    );
    expect(check.conditions[0]!.observed).toEqual({ kind: "redacted" });
    expect(check.nextStep).toBe("Address it and rerun reviewer.");
    expect(JSON.stringify(check)).not.toContain("stale");
  });
});

describe("when the receipt meets it and the run doesn't", () => {
  const met = explainRequirement(requirement(), authoritativeEvent());

  test("changed work has its own reason and keeps the conditions", () => {
    expect(
      explainRunShortfall({ agent: "reviewer" }, met, false),
    ).toMatchObject({
      met: false,
      reason: "work_changed",
      nextStep: "Rerun reviewer on the current work.",
      conditions: met.conditions,
    });
  });

  test("an unknown revision says so", () => {
    expect(explainRunShortfall({ agent: "reviewer" }, met, true).reason).toBe(
      "subject_unknown",
    );
  });
});
