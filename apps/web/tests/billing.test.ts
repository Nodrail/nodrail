import { describe, expect, test } from "vitest";
import {
  effectivePlan,
  usageFrom,
  type SubscriptionRecord,
} from "@/contracts/v1/billing";

const now = new Date("2026-11-09T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const pro = (status: string, pastDueSince: Date | null = null) =>
  ({ plan: "pro", status, pastDueSince }) satisfies SubscriptionRecord;

describe("what a workspace is entitled to", () => {
  test.each([
    ["no record", null, "free"],
    ["active", pro("active"), "pro"],
    ["trialing", pro("trialing"), "pro"],
    ["payment just failed", pro("past_due", daysAgo(1)), "pro"],
    ["unpaid within grace", pro("unpaid", daysAgo(6)), "pro"],
    ["past grace", pro("past_due", daysAgo(8)), "free"],
    ["canceled", pro("canceled"), "free"],
    ["incomplete", pro("incomplete"), "free"],
    ["an unknown status", pro("something_new"), "free"],
    ["free plan, active", { ...pro("active"), plan: "free" }, "free"],
  ] as const)("%s", (_label, record, expected) => {
    expect(effectivePlan(record, now)).toBe(expected);
  });
});

describe("usage", () => {
  test.each([
    [0, "ok"],
    [799, "ok"],
    [800, "near"],
    [999, "near"],
    [1000, "reached"],
    [1500, "reached"],
  ] as const)("%i of 1000 is %s", (used, state) => {
    expect(usageFrom(used, 1000)).toEqual({ used, limit: 1000, state });
  });
});
