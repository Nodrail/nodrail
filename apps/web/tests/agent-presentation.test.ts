import { describe, expect, test } from "vitest";
import {
  agentBadge,
  avatarTone,
  checkInSummary,
  lastCheckIn,
  toolLabels,
} from "@/features/agents/presentation";
import { plural } from "@/lib/text";
import { timeAgo } from "@/lib/time";

const now = Date.parse("2026-11-08T12:00:00Z");
const before = (seconds: number) =>
  new Date(now - seconds * 1000).toISOString();

describe("timeAgo", () => {
  test.each([
    [10, "just now"],
    [120, "2 min ago"],
    [3600, "1 hour ago"],
    [7200, "2 hours ago"],
    [86400, "1 day ago"],
    [172800, "2 days ago"],
  ])("%d seconds reads as %s", (seconds, expected) => {
    expect(timeAgo(before(seconds), now)).toBe(expected);
  });

  test("a clock slightly ahead does not read as the future", () => {
    expect(timeAgo(before(-30), now)).toBe("just now");
  });
});

describe("plural", () => {
  test.each([
    [1, "1 group"],
    [0, "0 groups"],
    [2, "2 groups"],
  ])("%d", (count, expected) => {
    expect(plural(count, "group")).toBe(expected);
  });
});

describe("agent presentation", () => {
  test("a missing check-in is stated, not blank", () => {
    expect(lastCheckIn(null)).toBe("None yet");
    expect(checkInSummary(null)).toBe("No check-in yet");
  });

  test("the badge is Paused, or how the integration reports, never Active", () => {
    expect(agentBadge("active", "never_reported").label).toBe(
      "Waiting for first check-in",
    );
    expect(agentBadge("active", "stale").label).toBe("Stale");
    expect(agentBadge("active", "reporting").label).toBe("Reporting");
    expect(agentBadge("paused", "reporting").label).toBe("Paused");
  });

  test("known tools are named properly and unknown ones pass through", () => {
    expect(toolLabels(["github", "acme-crm"])).toEqual(["GitHub", "acme-crm"]);
  });

  test("an agent keeps its colour", () => {
    expect(avatarTone("support-agent")).toBe(avatarTone("support-agent"));
  });
});
