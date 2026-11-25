// Reporting schema 3 on run events: a finished step's declared receipt
// state and contract digest are kept with the local run, never its values;
// a span that contradicts itself is refused, and an older schema ignores
// them.
import { describe, expect, test } from "vitest";
import { withWorkspace } from "@/server/db/context";
import { listLocalRuns } from "@/server/modules/reporting/list";
import { json, reportingToken, send, span } from "./reporting-world";
import { createWorkspace, useDatabase } from "./world";

useDatabase();

const DIGEST = `sha256:${"c".repeat(64)}`;

const finished = (extra: Record<string, string>) =>
  span("nodrail.run.event", {
    "nodrail.host": "claude-code",
    "nodrail.machine": "f".repeat(32),
    "nodrail.run": "a".repeat(32),
    "nodrail.step": "review",
    "nodrail.agent": "reviewer",
    "nodrail.run.event": "step.finished",
    ...extra,
  });

const rejected = (result: { bytes: Uint8Array }) =>
  Number(json(result.bytes).partialSuccess?.rejectedSpans ?? 0);

async function reported(schema: string, extra: Record<string, string>) {
  const w = await createWorkspace();
  const token = await reportingToken(w, w.owner);
  const result = await send(token, [finished(extra)], {
    protocol: "otlp-http/json",
    schema,
  });
  const runs = await withWorkspace(w.owner, w.id, (context) =>
    listLocalRuns(context, "development"),
  );
  return { rejected: rejected(result), step: runs[0]?.steps[0] };
}

describe("a finished step's receipt state (schema 3)", () => {
  test("is kept with its contract digest", async () => {
    const { rejected: count, step } = await reported("3", {
      "nodrail.receipt.state": "invalid",
      "nodrail.receipt.contract": DIGEST,
    });
    expect(count).toBe(0);
    expect(step).toMatchObject({
      verdict: null,
      receiptState: "invalid",
      receiptContract: DIGEST,
    });
  });

  test.each([
    ["a state without its contract", { "nodrail.receipt.state": "valid" }],
    [
      "a verdict on an invalid receipt",
      {
        "nodrail.receipt.state": "invalid",
        "nodrail.receipt.contract": DIGEST,
        "nodrail.verdict": "ship",
      },
    ],
    [
      "a malformed digest",
      {
        "nodrail.receipt.state": "valid",
        "nodrail.receipt.contract": "c".repeat(64),
      },
    ],
  ])("refuses %s", async (_, extra) => {
    expect((await reported("3", extra)).rejected).toBe(1);
  });

  test("is ignored under an older schema", async () => {
    const { rejected: count, step } = await reported("2", {
      "nodrail.receipt.state": "valid",
      "nodrail.receipt.contract": DIGEST,
      "nodrail.verdict": "ship",
    });
    expect(count).toBe(0);
    expect(step).toMatchObject({
      verdict: "ship",
      receiptState: null,
      receiptContract: null,
    });
  });
});
