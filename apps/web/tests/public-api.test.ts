import { describe, expect, test } from "vitest";
import { createApiTokenInput } from "@/contracts/v1/api-tokens";
import { activityApiQuery, decisionBody } from "@/contracts/v1/public-api";
import { toWire } from "@/server/public-api/wire";

describe("answers on the wire", () => {
  test("are snake_case, keep what agents sent and drop screen hints", () => {
    expect(
      toWire({
        agentKey: "bot",
        canDecide: true,
        canManageRules: true,
        hold: { missing: [{ agent: "qa", verdicts: ["pass"] }] },
        parameters: { someField: { innerKey: 1 } },
        reports: [{ receivedAt: "t", details: { exitCode: 0 } }],
      }),
    ).toEqual({
      agent_key: "bot",
      can_decide: true,
      hold: { missing: [{ agent: "qa", verdicts: ["pass"] }] },
      parameters: { someField: { innerKey: 1 } },
      reports: [{ received_at: "t", details: { exitCode: 0 } }],
    });
  });
});

describe("creating a token", () => {
  test("always includes read, once", () => {
    expect(
      createApiTokenInput.parse({
        name: " laptop ",
        scopes: ["rules:write", "read", "rules:write"],
        expiresInDays: "90",
      }),
    ).toEqual({
      name: "laptop",
      scopes: ["read", "rules:write"],
      expiresInDays: 90,
    });
  });

  test.each([
    [{ name: "", scopes: [], expiresInDays: 90 }],
    [{ name: "x", scopes: ["admin"], expiresInDays: 90 }],
    [{ name: "x", scopes: [], expiresInDays: 7 }],
    [{ name: "x", scopes: [], expiresInDays: 90, owner: "someone" }],
  ])("refuses %j", (input) => {
    expect(createApiTokenInput.safeParse(input).success).toBe(false);
  });
});

describe("API requests", () => {
  test("a decision is allow once or deny, never always", () => {
    const digest = { expected_action_digest: "sha256:a" };
    expect(
      decisionBody.safeParse({ decision: "allow_once", ...digest }).success,
    ).toBe(true);
    expect(
      decisionBody.safeParse({ decision: "allow_always", ...digest }).success,
    ).toBe(false);
  });

  test("filters are checked, not ignored", () => {
    expect(activityApiQuery.parse({ limit: "10", outcome: "denied" })).toEqual({
      limit: 10,
      outcome: "denied",
    });
    expect(activityApiQuery.safeParse({ outcom: "denied" }).success).toBe(
      false,
    );
    expect(activityApiQuery.safeParse({ run: "not-a-run" }).success).toBe(
      false,
    );
  });
});
