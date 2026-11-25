import type { RunHoldDto } from "@/contracts/v1/runs";

/** A gate holding a pull request: qa reported fail, reviewer passed. */
export const gateHold: RunHoldDto = {
  kind: "gate",
  id: "review",
  name: "Review before the pull request",
  explanation: "Missing qa.",
  missing: [{ agent: "qa", verdicts: ["pass"], since: ["dev"] }],
  requirements: [
    {
      agent: "qa",
      verdicts: ["pass"],
      since: ["dev"],
      met: false,
      reported: { verdict: "fail", at: "2026-11-01T10:04:00Z" },
    },
    {
      agent: "reviewer",
      verdicts: ["ship"],
      since: [],
      met: true,
      reported: { verdict: "ship", at: "2026-11-01T10:03:00Z" },
    },
  ],
};
