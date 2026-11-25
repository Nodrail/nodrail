// Local sample runs for the Runs, Insights and Activity screens:
// gates and budgets on top of the sample rules, then agent teams working
// through the runtime as a real integration would. Run after `dev:seed`.
// Refuses anything but the local database.
import { randomBytes, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { withRuntime, withWorkspace } from "../src/server/db/context";
import { dataSourceOptions } from "../src/server/db/options";
import { rotateCredential } from "../src/server/modules/agents";
import {
  applyPolicyFile,
  exportPolicyFile,
  previewPolicyFile,
} from "../src/server/modules/policies/rule-files";
import { recordStep } from "../src/server/modules/runs/steps";
import { clock, moveBack } from "./seed-time";
import {
  reportOutcome,
  requestPermit,
  submitAction,
} from "../src/server/modules/runtime";

const databaseUrl =
  "postgres://postgres:nodrail_local_only@127.0.0.1:54329/nodrail_dev";
if (!process.env.DATABASE_URL?.includes("@127.0.0.1:"))
  throw new Error("The run seed only runs against the local database");

const ENV = "development";

const TEAM_RULES = `
- list: builders
  items: [dev, infra]

- rule: Start subagents
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: any }
  effect: allow

- rule: Edit project files
  tool: files
  operation: file.edit
  resource: { kind: file, match: prefix, value: /work/ }
  effect: allow

- rule: Write project files
  tool: files
  operation: file.write
  resource: { kind: file, match: prefix, value: /work/ }
  effect: allow

- list: team_commands
  items: [pnpm test, pnpm lint, pnpm build, git status, git diff, git add, git commit, git push]

- rule: Everyday commands
  command: { list: team_commands, match: prefix }
  effect: allow

- gate: Review before the pull request
  id: review-before-pr
  tool: claude-code
  operation: agent
  resource: { kind: agent, match: exact, value: github }
  requires:
    - { agent: qa, verdict: pass, since: { list: builders } }
    - { agent: reviewer, verdict: [ship, ship_with_debt], since: { list: builders } }
  otherwise: deny

- gate: Review before a push
  id: review-before-push
  command: { prefix: git push }
  requires:
    - { agent: reviewer, verdict: [ship, ship_with_debt], since: { list: builders } }
  otherwise: deny

- budget: Builder step
  id: builder-step
  step_agent: dev
  per: step
  tool_calls: 6
  warn_at: 4
  otherwise: deny

- budget: Run spend
  id: run-spend
  per: run
  usd: 12
  warn_at: 8
  otherwise: deny
`;

type Token = string;
type Scope = Awaited<ReturnType<typeof owner>>;
type Run = { key: string; token: Token; scope: Scope };

const admin = new DataSource(dataSourceOptions(databaseUrl));

/** The owner of the sample workspace, with a session of its own for this run. */
async function owner() {
  const [row]: { workspace_id: string; user_id: string; account_id: string }[] =
    await admin.query(
      `SELECT w.id AS workspace_id, u.id AS user_id, a.id AS account_id
       FROM nodrail.workspaces w
       JOIN nodrail.workspace_memberships m ON m.workspace_id = w.id
       JOIN nodrail.users u ON u.id = m.user_id
       JOIN nodrail.external_auth_accounts a ON a.user_id = u.id
       WHERE w.slug = 'acme-studio' AND u.verified_email = 'dev@nodrail.test'
       LIMIT 1`,
    );
  if (!row) throw new Error("Run `pnpm dev:seed` first");
  const [session]: { id: string }[] = await admin.query(
    `INSERT INTO nodrail.human_sessions
       (user_id, external_auth_account_id, provider_session_id, expires_at)
     VALUES ($1, $2, $3, clock_timestamp() + interval '10 minutes')
     RETURNING id`,
    [row.user_id, row.account_id, randomUUID()],
  );
  if (!session) throw new Error("Could not open a seed session");
  return {
    workspaceId: row.workspace_id,
    principal: { userId: row.user_id, sessionId: session.id },
  };
}

/** The sample rules, plus a team's gates and budgets. */
async function publishTeamRules(scope: Scope) {
  await withWorkspace(scope.principal, scope.workspaceId, async (context) => {
    const current = await exportPolicyFile(context, ENV);
    // Published by an earlier seed: run again, it only adds runs.
    if (current.includes("Review before the pull request")) return;
    const text = `${current.replace(/required_engine_version: \d+/, "required_engine_version: 3")}\n${TEAM_RULES}`;
    const preview = await previewPolicyFile(context, ENV, text);
    if (preview.issues.length)
      throw new Error(JSON.stringify(preview.issues, null, 2));
    await applyPolicyFile(context, ENV, text, {
      revision: preview.policyRevision,
      fileDigest: preview.fileDigest,
    });
  });
}

async function tokens(scope: Scope) {
  const installations: { id: string }[] = await admin.query(
    // Active agents only: a paused one is denied everything, which is a
    // different story from the one these runs tell.
    `SELECT i.id FROM nodrail.installations i
     JOIN nodrail.environments e ON e.id = i.environment_id
     JOIN nodrail.agents a ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
     WHERE i.workspace_id = $1 AND e.slug = $2 AND a.paused_at IS NULL
     ORDER BY i.name LIMIT 2`,
    [scope.workspaceId, ENV],
  );
  return Promise.all(
    installations.map(({ id }) =>
      withWorkspace(scope.principal, scope.workspaceId, (context) =>
        rotateCredential(context, id),
      ).then((issued) => issued.secret),
    ),
  );
}

type Step = { id: string; agent: string };

const step = (run: Run, agent: string): Step => ({
  id: `${agent}-${randomUUID().slice(0, 6)}`,
  agent,
});

const record = (run: Run, body: object) =>
  withRuntime(run.token, "actions:submit", (context) =>
    recordStep(context, { run: { key: run.key }, ...body }),
  );

async function act(run: Run, by: Step | null, call: object, finish = false) {
  const status = await withRuntime(run.token, "actions:submit", (context) =>
    submitAction(context, randomUUID(), {
      params: {},
      ...call,
      run: { key: run.key, ...(by ? { step: by } : {}) },
    }),
  );
  if (!finish || status.code !== "READY") return status;
  await permitAndReport(run, status);
  return status;
}

/** Asks for the permit of a READY action and reports it ran. */
async function permitAndReport(
  run: Run,
  status: { action_id: string; action_digest: string },
) {
  const permit = await withRuntime(run.token, "permits:request", (context) =>
    requestPermit(context, status.action_id, {
      action_digest: status.action_digest,
      nonce: randomBytes(12).toString("hex"),
    }),
  );
  if (permit.code === "ALLOW")
    await withRuntime(run.token, "reports:write-own", (context) =>
      reportOutcome(context, status.action_id, {
        report_key: randomUUID(),
        outcome: "success",
        permit_id: permit.permit_id,
        details: { duration_ms: 300 + Math.floor(Math.random() * 900) },
      }),
    );
}

const edit = (path: string) => ({
  tool: "files",
  operation: "file.edit",
  resource: { kind: "file", id: `/work/acme/${path}` },
});
const command = (line: string) => ({
  tool: "shell",
  operation: "command.run",
  resource: { kind: "command", id: line },
});
const dispatch = (agent: string) => ({
  tool: "claude-code",
  operation: "agent",
  resource: { kind: "agent", id: agent },
  params: { subagent_type: agent },
});

async function work(
  run: Run,
  agent: string,
  calls: object[],
  receipt: {
    verdict: string;
    findings?: string[];
    usd?: number;
    tokens?: number;
  },
) {
  await act(run, null, dispatch(agent), true);
  const s = step(run, agent);
  await record(run, { step: s, event: "started" });
  for (const call of calls) await act(run, s, call, true);
  const findings = receipt.findings?.length
    ? `\nfindings: [${receipt.findings.join(", ")}]`
    : "";
  const usage = `${receipt.usd ? `\nusd: ${receipt.usd}` : ""}${receipt.tokens ? `\ntokens: ${receipt.tokens}` : ""}`;
  await record(run, {
    step: s,
    event: "finished",
    receipt: {
      text: `Done.\n\n\`\`\`nodrail-receipt\nverdict: ${receipt.verdict}${findings}${usage}\n\`\`\``,
    },
  });
}

/** The main agent asks for a command no rule covers: denied each time. */
async function askedAgain(run: Run, line: string, times: number) {
  for (let i = 0; i < times; i += 1) await act(run, null, command(line));
}

/** Built, checked, reviewed and shipped; the first PR attempt was held. */
async function shipped(run: Run) {
  await askedAgain(run, "pnpm audit --prod", 4);
  await work(
    run,
    "dev",
    [
      edit("src/auth/login.ts"),
      edit("src/auth/session.ts"),
      command("pnpm test"),
    ],
    { verdict: "done", usd: 1.8, tokens: 41_000 },
  );
  await act(run, null, dispatch("github"));
  await work(run, "qa", [command("pnpm test"), command("pnpm lint")], {
    verdict: "pass",
    usd: 0.6,
    tokens: 12_000,
  });
  await work(run, "reviewer", [command("git diff")], {
    verdict: "ship",
    findings: ["naming"],
    usd: 0.9,
    tokens: 18_000,
  });
  await act(run, null, dispatch("github"), true);
  await act(run, null, command("git push origin fix-login"), true);
}

/** QA failed, the fix came back, and the PR is waiting for a person. */
async function held(run: Run) {
  await work(run, "dev", [edit("src/billing/retry.ts"), command("pnpm test")], {
    verdict: "done",
    usd: 2.4,
    tokens: 52_000,
  });
  await work(run, "qa", [command("pnpm test")], {
    verdict: "fail",
    findings: ["flaky-test", "missing-retry-cap"],
    usd: 0.7,
    tokens: 15_000,
  });
  await work(
    run,
    "dev",
    [edit("src/billing/retry.ts"), edit("src/billing/retry.test.ts")],
    { verdict: "done", usd: 1.1, tokens: 23_000 },
  );
  await act(run, null, dispatch("github"));
  await act(run, null, command("git push origin billing-retry"));
}

/** A builder that ran past its step budget, in a run near its spend limit. */
async function overBudget(run: Run) {
  const files = ["a", "b", "c", "d", "e", "f", "g"].map((name) =>
    edit(`src/limits/${name}.ts`),
  );
  await work(run, "dev", files, { verdict: "done", usd: 8.6, tokens: 190_000 });
  await work(run, "qa", [command("pnpm test")], {
    verdict: "pass",
    usd: 0.5,
    tokens: 9_000,
  });
}

/** Infra work reviewed with debt, then shipped. */
async function infra(run: Run) {
  await work(run, "infra", [edit("infra/queue.tf"), command("pnpm build")], {
    verdict: "done",
    usd: 1.3,
    tokens: 30_000,
  });
  await work(run, "qa", [command("pnpm test")], {
    verdict: "pass",
    usd: 0.4,
    tokens: 8_000,
  });
  await work(run, "reviewer", [command("git diff")], {
    verdict: "ship_with_debt",
    findings: ["todo-cleanup"],
    usd: 0.8,
    tokens: 14_000,
  });
  await act(run, null, dispatch("github"), true);
}

/** A run with only the main agent: no steps, so gates stay closed. */
async function solo(run: Run) {
  await act(run, null, edit("README.md"), true);
  await act(run, null, command("git status"), true);
  await act(run, null, dispatch("github"));
}

async function main() {
  await admin.initialize();
  try {
    const scope = await owner();
    await publishTeamRules(scope);
    const [first, second = first] = await tokens(scope);
    if (!first) throw new Error("No sample installation in development");
    const since = await clock(admin);
    // Days ago each run happened, so Insights' 7, 30 and 90 days differ.
    const runs: [(run: Run) => Promise<void>, string, Token, number][] = [
      [shipped, "github.com/acme/app/fix-login", first, 3],
      [held, "github.com/acme/app/billing-retry", first, 0],
      [overBudget, "github.com/acme/api/rate-limits", first, 12],
      [infra, "github.com/acme/infra/queue-workers", second, 40],
      [solo, "github.com/acme/app/readme-typo", second, 75],
    ];
    for (const [story, key, token] of runs) await story({ key, token, scope });
    for (const [, key, , days] of runs)
      await moveBack(admin, {
        workspaceId: scope.workspaceId,
        key,
        days,
        since,
      });
    console.log("Sample runs recorded in Acme Studio, development.");
  } finally {
    await admin.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
