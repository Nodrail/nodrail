import type { ReportDto } from "@/contracts/v1/reports";

/**
 * Five runs, counted by hand. The unit test builds them as rows; the backend
 * test drives the same runs through the API. Times are minutes into a run.
 *
 * feat/a  dev done · qa fail · github HELD (approved) · dev done · qa pass ·
 *         qa fail · dev done · qa pass · reviewer ship · github ready
 * feat/b  qa pass · dev (3 helper calls, the third HELD by the budget; no
 *         receipt) · deploy ready · qa fail · github HELD (denied)
 * feat/c  qa fail · dev done · qa PASS · reviewer ship_with_debt · github ready
 * feat/d  deploy HELD (deny gate) · infra started, still running
 * feat/e  helper ready
 *
 * Review gate: covers the 4 github calls; 2 held; first call held in a and b,
 * not in c, so 1 of 3 first-pass; 1 of 2 holds approved, 1 denied.
 * Deploy gate: covers b and d; d held; 1 of 2 first-pass; deny, so no approvals.
 * Back-steps: dev twice in a (after qa fail each time). Not dev in c: its
 * first step. Not qa in b: dev is not a check, and its missing receipt is not a
 * rejection.
 * Contradicted: qa in a (pass at 9, fail at 11, no dev or infra between). Not
 * qa in b: dev worked between the pass and the fail.
 * Runs: steps 8, 3, 4, 1, 0, median 3. Reached a gate: a, b, c, d; only c
 * without a hold.
 * Missing: both review holds lacked qa and reviewer (b's qa pass came before
 * dev worked); the deploy hold lacked qa.
 * Checks: qa ran in a, b and c and passed first in b only, eventually in
 * all three; reviewer passed at once in a and c.
 * Rework loops: a builder starting after a check failed since the previous
 * builder start: dev at 6 and 12 in a, dev at 3 in c. Not b: its dev started
 * before qa failed. So 3 loops, in 2 runs.
 * Spend: a's first dev $1.50 and 1,000 tokens, a's first qa $0.50 and 200,
 * c's dev $2 and 3,000. Both a and c spent $2; c used more tokens.
 */
const afterBuilders = "after the latest change and after any dev or infra step";
const none = { usd: 0, tokens: 0 };

export const expectedReport: ReportDto = {
  gates: [
    {
      id: "review",
      name: "Review before the pull request",
      checked: 4,
      held: 2,
      firstPass: { count: 1, of: 3 },
      missing: [
        { label: `qa must report pass ${afterBuilders}`, count: 2 },
        {
          label: `reviewer must report ship or ship_with_debt ${afterBuilders}`,
          count: 2,
        },
      ],
    },
    {
      id: "deploy",
      name: "QA before a deploy",
      checked: 2,
      held: 1,
      firstPass: { count: 1, of: 2 },
      missing: [{ label: "qa must report pass", count: 1 }],
    },
  ],
  budgets: [
    {
      id: "budget",
      name: "Builder step",
      hits: 1,
      runs: [{ id: "b", key: "feat/b" }],
    },
  ],
  agents: [
    {
      agent: "dev",
      steps: 5,
      verdicts: [{ verdict: "done", count: 4 }],
      withoutReceipt: 1,
      backSteps: 2,
      contradictedPasses: 0,
      spend: { usd: 3.5, tokens: 4000 },
    },
    {
      agent: "infra",
      steps: 1,
      verdicts: [],
      withoutReceipt: 0,
      backSteps: 0,
      contradictedPasses: 0,
      spend: none,
    },
    {
      agent: "qa",
      steps: 8,
      verdicts: [
        { verdict: "fail", count: 4 },
        { verdict: "pass", count: 4 },
      ],
      withoutReceipt: 0,
      backSteps: 0,
      contradictedPasses: 1,
      spend: { usd: 0.5, tokens: 200 },
    },
    {
      agent: "reviewer",
      steps: 2,
      verdicts: [
        { verdict: "ship", count: 1 },
        { verdict: "ship_with_debt", count: 1 },
      ],
      withoutReceipt: 0,
      backSteps: 0,
      contradictedPasses: 0,
      spend: none,
    },
  ],
  runs: {
    count: 5,
    medianSteps: 3,
    withoutHold: { count: 1, of: 4 },
    reworkLoops: 3,
    withRework: 2,
    spend: { usd: 4, tokens: 4200 },
  },
  checks: [
    { agent: "qa", runs: 3, firstTry: 1, eventually: 3 },
    { agent: "reviewer", runs: 2, firstTry: 2, eventually: 2 },
  ],
  topRuns: [
    {
      id: "c",
      key: "feat/c",
      steps: 4,
      reworkLoops: 1,
      spend: { usd: 2, tokens: 3000 },
    },
    {
      id: "a",
      key: "feat/a",
      steps: 8,
      reworkLoops: 2,
      spend: { usd: 2, tokens: 1200 },
    },
  ],
};

/** Ids differ between the fixture and the database; names do not. */
export const withoutIds = (report: ReportDto) => ({
  ...report,
  gates: report.gates.map(({ id: _id, ...gate }) => gate),
  budgets: report.budgets.map(({ id: _id, runs, ...budget }) => ({
    ...budget,
    runs: runs.map(({ key }) => key),
  })),
  topRuns: report.topRuns.map(({ id: _id, ...run }) => run),
});
