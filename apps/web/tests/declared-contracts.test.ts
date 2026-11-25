// Declared contracts on the wire: inputs survive a round trip unchanged; digests,
// names and paths are the engine's; issues never carry a value; reported
// events can't look authoritative; selectors stay bounded.
import { describe, expect, test } from "vitest";
import {
  canAuthorize,
  contractEventAttributes,
  safeValidationIssue,
  submitContractEventInput,
} from "@/contracts/v1/contract-events";
import { contractSelectorInput } from "@/contracts/v1/contract-reads";
import {
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_SELECTOR_FILTERS,
  bindsSurface,
  contractClosureInput,
  contractSurfaces,
  projectionRevisionInput,
  shapePath,
  surfaceCoverage,
} from "@/contracts/v1/declared-contracts";
import { resolvedShape } from "@/contracts/v1/resolved-shape";
import { contractDigest } from "@/contracts/v1/shapes-engine";
import {
  closureInput,
  otherDigest,
  projectionInput,
  receiptAttributes as span,
  reviewer,
  revisionInput,
  without,
} from "./support/contract-fixtures";

/** Parse, serialize, parse again: the second parse must equal the first. */
const roundTrips = <T>(
  schema: { parse: (v: unknown) => T },
  input: unknown,
) => {
  const once = schema.parse(input);
  const twice = schema.parse(JSON.parse(JSON.stringify(once)));
  expect(twice).toEqual(once);
  return once;
};

describe("the engine's grammar, as Cloud reads it", () => {
  test("the engine's resolved shape and projection parse unchanged", () => {
    expect(roundTrips(resolvedShape, reviewer.shape)).toEqual(reviewer.shape);
    expect(roundTrips(projectionRevisionInput, projectionInput())).toEqual(
      projectionInput(),
    );
  });

  test("digests are sha256:-prefixed and domain separated", () => {
    expect(reviewer.contract).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(contractDigest("shape", reviewer.shape)).toBe(reviewer.contract);
    // The same content under another domain is another digest.
    expect(contractDigest("projection", reviewer.shape)).not.toBe(
      reviewer.contract,
    );
    expect(
      contractClosureInput.safeParse({
        ...closureInput(),
        revisions: [{ ...revisionInput(), digest: reviewer.contract.slice(7) }],
      }).success,
    ).toBe(false);
  });

  test("withheld paths are names only, and the verdict is reported by default", () => {
    // The engine keeps withheld paths sorted (a set), so order never changes a digest.
    expect(reviewer.projection.withheld).toEqual(["anchor", "issue", "note"]);
    expect(Object.keys(reviewer.projection.shape.properties)).toEqual([
      "verdict",
      "lesson",
      "findings",
    ]);
  });

  test("property names have no hyphens; paths are at most four deep", () => {
    expect(shapePath.safeParse("findings.blocker").success).toBe(true);
    for (const path of ["ship-with-debt", "a.b.c.d.e", "A", "a..b"])
      expect(shapePath.safeParse(path).success, path).toBe(false);
  });

  test("a shape over the grammar's limits is refused", () => {
    const leaf = reviewer.shape.properties.issue!;
    const wide = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`p${i}`, leaf]),
    );
    expect(
      resolvedShape.safeParse({ for: null, properties: wide }).success,
    ).toBe(false);
    const nest = (depth: number): object =>
      depth === 0
        ? leaf
        : { ...leaf, type: "object", properties: { a: nest(depth - 1) } };
    expect(
      resolvedShape.safeParse({ for: null, properties: { a: nest(4) } })
        .success,
    ).toBe(false);
    expect(
      resolvedShape.safeParse({
        for: null,
        properties: { a: { ...leaf, pattern: ".*" } },
      }).success,
    ).toBe(false);
  });

  test("the engine's schema, with what only its compiler checks", () => {
    const leaf = reviewer.shape.properties.issue!;
    const accepts = (properties: object) =>
      resolvedShape.safeParse({ for: null, properties }).success;
    expect(accepts({ "Bad-Name": leaf })).toBe(false);
    expect(accepts({ a: { ...leaf, max: 100_000 } })).toBe(false);
    expect(
      accepts({
        a: {
          ...leaf,
          type: "list",
          min: 0,
          max: 5,
          of: { ...leaf, type: "date", min: "2026-02-30", max: null },
        },
      }),
    ).toBe(false);
    expect(
      accepts({
        a: {
          optional: false,
          for: null,
          report: null,
          classification: null,
          role: null,
          type: "enum",
          values: ["Not A Value"],
        },
      }),
    ).toBe(false);
    expect(accepts({ a: leaf })).toBe(true);
  });

  test("a projection lists its withheld paths sorted, as the engine digests them", () => {
    expect(
      projectionRevisionInput.safeParse({
        ...projectionInput(),
        withheld: ["token", "findings"],
      }).success,
    ).toBe(false);
    expect(
      projectionRevisionInput.safeParse({
        ...projectionInput(),
        withheld: ["findings", "token"],
      }).success,
    ).toBe(true);
  });
});

describe("publish closure", () => {
  test("revisions and bindings round-trip unchanged", () => {
    expect(roundTrips(contractClosureInput, closureInput())).toEqual(
      closureInput(),
    );
  });

  test("a binding must name a revision of the closure", () => {
    const closure = closureInput();
    const result = contractClosureInput.safeParse({
      ...closure,
      bindings: [{ ...closure.bindings[0], contract_digest: otherDigest("c") }],
    });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([
      ["bindings", 0, "contract_digest"],
    ]);
  });

  test("binding names are the engine's, and belong to their surface", () => {
    expect(bindsSurface("receipt", "receipt:qa")).toBe(true);
    expect(bindsSurface("tool_input", "input:stripe.refund")).toBe(true);
    expect(bindsSurface("memory_record", "input:notes.write")).toBe(true);
    // Approval forms were removed: their binding names belong to no surface.
    expect(bindsSurface("receipt", "request:refund")).toBe(false);
    expect(bindsSurface("inventory_metadata", "inventory")).toBe(true);
    expect(bindsSurface("receipt", "brief:qa")).toBe(false);
    const closure = closureInput();
    for (const target of ["agent:reviewer", "file:docs/adr/*.md", "receipt:"])
      expect(
        contractClosureInput.safeParse({
          ...closure,
          bindings: [{ ...closure.bindings[0], target }],
        }).success,
        target,
      ).toBe(false);
  });

  test("only dialect 1 is read", () => {
    expect(
      contractClosureInput.safeParse({
        ...closureInput(),
        revisions: [{ ...revisionInput(), dialect: "shapes/v1" }],
      }).success,
    ).toBe(false);
  });

  test("every surface maps to its coverage id", () => {
    expect(contractSurfaces.map((surface) => surfaceCoverage[surface])).toEqual(
      ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S09"],
    );
  });
});

describe("safe validation issues", () => {
  test("a path and a code round-trip; the engine's codes are kept", () => {
    const issue = { path: "findings.blocker", code: "below" };
    expect(roundTrips(safeValidationIssue, issue)).toEqual(issue);
    expect(
      safeValidationIssue.parse({ path: "items.3.name", code: "too-long" }),
    ).toEqual({ path: "items.3.name", code: "too-long" });
  });

  test("the whole value has no path", () => {
    expect(
      safeValidationIssue.parse({ path: "(value)", code: "type" }),
    ).toEqual({ path: null, code: "type" });
  });

  test("the rejected value is refused, under any name", () => {
    for (const echo of ["value", "received", "message", "input"])
      expect(
        safeValidationIssue.safeParse({
          path: "findings.blocker",
          code: "type",
          [echo]: "sk-live-123",
        }).success,
        echo,
      ).toBe(false);
  });

  test("a path is a declared path, never text with a value in it", () => {
    for (const path of ["findings.blocker: 5", "token=abc", "a..b", "A", ""])
      expect(
        safeValidationIssue.safeParse({ path, code: "type" }).success,
        path,
      ).toBe(false);
  });

  test("a code an older Cloud doesn't know is kept as other", () => {
    expect(safeValidationIssue.parse({ path: "a", code: "brand_new" })).toEqual(
      { path: "a", code: "other" },
    );
  });
});

describe("reported contract events", () => {
  test("a valid receipt span reads with its projected values", () => {
    const parsed = contractEventAttributes.parse(span());
    expect(parsed["nodrail.contract.payload"]).toEqual({
      verdict: "ship",
      findings: { blocker: 0, major: 1 },
    });
    expect(parsed["nodrail.contract.findings"]).toBe(1);
  });

  test("an invalid receipt has issues, and no verdict or findings", () => {
    const invalid = without(span(), "nodrail.contract.findings");
    invalid["nodrail.contract.validation"] = "invalid";
    invalid["nodrail.contract.issues"] = JSON.stringify([
      { path: "findings.blocker", code: "type" },
    ]);
    expect(contractEventAttributes.safeParse(invalid).success).toBe(true);
    for (const wrong of [
      { "nodrail.contract.verdict": "ship" },
      { "nodrail.contract.findings": "1" },
      { "nodrail.contract.issues": "[]" },
    ])
      expect(
        contractEventAttributes.safeParse({ ...invalid, ...wrong }).success,
      ).toBe(false);
  });

  test("an issue that echoes a value refuses the whole span", () => {
    expect(
      contractEventAttributes.safeParse(
        span({
          "nodrail.contract.validation": "invalid",
          "nodrail.contract.issues": JSON.stringify([
            { path: "token", code: "type", received: "sk-live-123" },
          ]),
        }),
      ).success,
    ).toBe(false);
  });

  test("a local report can only be agent-reported or runtime-observed", () => {
    for (const producer of [
      "externally-verified",
      "person-authenticated",
      "agent_reported",
    ])
      expect(
        contractEventAttributes.safeParse(
          span({ "nodrail.contract.producer": producer }),
        ).success,
        producer,
      ).toBe(false);
  });

  test("a later dialect is refused, never read as this one", () => {
    expect(
      contractEventAttributes.safeParse(
        span({ "nodrail.contract.dialect": "2" }),
      ).success,
    ).toBe(false);
  });

  test("missing and unsupported carry no validation, projection, payload or issues", () => {
    const bare = without(
      span(),
      "nodrail.contract.validation",
      "nodrail.contract.findings",
      "nodrail.contract.projection",
      "nodrail.contract.payload",
    );
    for (const capture of ["missing", "unsupported"]) {
      expect(
        contractEventAttributes.safeParse({
          ...bare,
          "nodrail.contract.capture": capture,
        }).success,
      ).toBe(true);
      expect(
        contractEventAttributes.safeParse({
          ...span(),
          "nodrail.contract.capture": capture,
        }).success,
      ).toBe(false);
      expect(
        contractEventAttributes.safeParse({
          ...bare,
          "nodrail.contract.capture": capture,
          "nodrail.contract.issue_count": "2",
        }).success,
      ).toBe(false);
    }
  });

  test("a payload over the receipt ceiling is refused", () => {
    expect(
      contractEventAttributes.safeParse(
        span({
          "nodrail.contract.payload": JSON.stringify({
            note: "x".repeat(MAX_EVENT_PAYLOAD_BYTES),
          }),
        }),
      ).success,
    ).toBe(false);
  });

  test("an execution outcome belongs to a tool result only", () => {
    expect(
      contractEventAttributes.safeParse(
        span({ "nodrail.contract.execution": "succeeded" }),
      ).success,
    ).toBe(false);
  });
});

describe("authoritative submissions", () => {
  const submission = {
    surface: "tool_result",
    contract_digest: otherDigest("a"),
    idempotency_key: "call-1",
    run: { key: "release-42" },
    step: "deploy",
    action_digest: otherDigest("c"),
    capture: "captured",
    payload: { status: "ok" },
    execution: "succeeded",
  };

  test("round-trips", () => {
    expect(roundTrips(submitContractEventInput, submission)).toEqual(
      submission,
    );
  });

  test("provenance comes from the credential, never the body", () => {
    for (const field of [
      "authority",
      "producer_class",
      "validated_by",
      "agent",
      "subject",
    ])
      expect(
        submitContractEventInput.safeParse({ ...submission, [field]: "x" })
          .success,
        field,
      ).toBe(false);
  });

  test("a payload exactly when captured", () => {
    const missing = Object.fromEntries(
      Object.entries(submission).filter(([key]) => key !== "payload"),
    );
    expect(
      submitContractEventInput.safeParse({ ...missing, capture: "missing" })
        .success,
    ).toBe(true);
    expect(submitContractEventInput.safeParse(missing).success).toBe(false);
  });
});

describe("only authoritative, server-validated events authorize", () => {
  const valid = {
    capture: "captured",
    validation: "valid",
  } as const;

  test.each([
    [{ ...valid, authority: "authoritative", validatedBy: "server" }, true],
    [{ ...valid, authority: "reported", validatedBy: "producer" }, false],
    [{ ...valid, authority: "reported", validatedBy: "server" }, false],
    [{ ...valid, authority: "authoritative", validatedBy: "producer" }, false],
    [
      {
        authority: "authoritative",
        capture: "captured",
        validation: "invalid",
        validatedBy: "server",
      },
      false,
    ],
    [
      {
        authority: "authoritative",
        capture: "unsupported",
        validation: null,
        validatedBy: null,
      },
      false,
    ],
  ] as const)("%o → %s", (event, expected) => {
    expect(canAuthorize(event)).toBe(expected);
  });
});

describe("insights selectors", () => {
  const selector = {
    projection: reviewer.projection.digest,
    measure: { aggregate: "sum", path: "findings.blocker" },
    group_by: "verdict",
    filters: [{ path: "verdict", in: ["ship", "fix-first"] }],
    days: 30,
  };

  test("round-trips", () => {
    expect(roundTrips(contractSelectorInput, selector)).toEqual(selector);
  });

  test("a filter is the grammar's where: exact, a range of numbers or dates, or in", () => {
    const withFilter = (filter: object) =>
      contractSelectorInput.safeParse({ ...selector, filters: [filter] })
        .success;
    expect(withFilter({ path: "n", min: 1, max: 3 })).toBe(true);
    expect(withFilter({ path: "due", min: "2026-01-01" })).toBe(true);
    expect(withFilter({ path: "n", in: [1, 2] })).toBe(true);
    expect(withFilter({ path: "due", min: "2026-02-30" })).toBe(false);
    expect(withFilter({ path: "n", min: 1, max: "2026-01-01" })).toBe(false);
    expect(withFilter({ path: "n", in: [1.5] })).toBe(false);
    expect(withFilter({ path: "n", equals: 1, min: 0 })).toBe(false);
    expect(withFilter({ path: "n" })).toBe(false);
    expect(withFilter({ path: "n", expression: "n > 1" })).toBe(false);
  });

  test("filters and the window are bounded", () => {
    expect(
      contractSelectorInput.safeParse({
        ...selector,
        filters: Array.from({ length: MAX_SELECTOR_FILTERS + 1 }, () => ({
          path: "n",
          equals: 1,
        })),
      }).success,
    ).toBe(false);
    expect(
      contractSelectorInput.safeParse({ ...selector, days: 365 }).success,
    ).toBe(false);
  });
});
