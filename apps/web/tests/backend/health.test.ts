import { describe, expect, test } from "vitest";
import {
  readWorkspace,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { pauseAgent } from "@/server/modules/agents";
import {
  getHealth,
  pausedAgents,
  silentAgents,
  stalledSteps,
  uncoveredInstallations,
} from "@/server/modules/health";
import { assignedOne, ENV } from "./activity-world";
import { publish, step } from "./runs-world";
import {
  addMember,
  admin,
  createAgent,
  createWorkspace,
  issueToken,
  seedAction,
  useDatabase,
  type TestAgent,
  type TestWorkspace,
} from "./world";

useDatabase();

const read = <T>(
  person: HumanPrincipal,
  w: TestWorkspace,
  check: (
    context: Parameters<typeof getHealth>[0],
    environment: string,
  ) => Promise<T>,
) => readWorkspace(person, w.id, (context) => check(context, ENV));

const seenMinutesAgo = (agent: TestAgent, minutes: number) =>
  admin.query(
    `UPDATE nodrail.installations
     SET last_seen_at = now() - make_interval(mins => $2) WHERE id = $1`,
    [agent.installationId, minutes],
  );

/** More actions for this agent; `matched` ones a rule decided. */
async function actions(
  w: TestWorkspace,
  agent: TestAgent,
  { unmatched = 0, matched = 0, daysAgo = 0 },
) {
  for (let index = 0; index < unmatched + matched; index += 1) {
    const { actionId } = await admin.transaction((manager) =>
      seedAction(manager, w, agent),
    );
    await admin.query(
      `UPDATE nodrail.action_requests
       SET initial_evaluation = $2,
           created_at = now() - make_interval(days => $3),
           expires_at = now() + interval '1 hour'
       WHERE id = $1`,
      [actionId, index < matched ? "ready" : "denied", daysAgo],
    );
    // A call no rule covered is denied, and recorded as such.
    if (index >= matched)
      await admin.query(
        `INSERT INTO nodrail.audit_events
           (workspace_id, event_type, actor_kind, decision_code, agent_id,
            action_request_id, environment_id)
         VALUES ($1, 'authorization.decided', 'runtime', 'denied_no_rule',
                 $2, $3, $4)`,
        [w.id, agent.id, actionId, w.environmentId],
      );
  }
}

describe("silent agents", () => {
  test("are installations not seen within the reporting window", async () => {
    const w = await createWorkspace();
    await createAgent(w, "never");
    const stale = await createAgent(w, "stale");
    const fresh = await createAgent(w, "fresh");
    await seenMinutesAgo(stale, 31);
    await seenMinutesAgo(fresh, 29);
    const silent = await read(w.owner, w, silentAgents);
    expect(silent.map((item) => item.agentKey)).toEqual(["stale", "never"]);
    expect(silent[1]).toEqual({
      agentKey: "never",
      installationName: "never-dev",
      lastSeenAt: null,
    });
  });

  test("leave out archived agents", async () => {
    const w = await createWorkspace();
    const gone = await createAgent(w, "gone");
    await admin.query(
      `UPDATE nodrail.agents SET archived_at = now() WHERE id = $1`,
      [gone.id],
    );
    expect(await read(w.owner, w, silentAgents)).toEqual([]);
  });
});

describe("paused agents", () => {
  test("are the agents a person paused, with who and when", async () => {
    const w = await createWorkspace();
    await createAgent(w, "busy");
    await createAgent(w, "stopped");
    await withWorkspace(w.owner, w.id, (context) =>
      pauseAgent(context, "stopped"),
    );
    expect(await read(w.owner, w, pausedAgents)).toEqual([
      {
        agentKey: "stopped",
        pausedAt: expect.any(String),
        pausedBy: "Owner",
      },
    ]);
  });
});

describe("stalled steps", () => {
  async function runWithOpenStep() {
    const w = await createWorkspace();
    const agent = await createAgent(w, "bot");
    await publish(w);
    const token = await issueToken(w, agent);
    await step(token, {
      run: { key: "fix-login" },
      step: { id: "dev-1", agent: "dev" },
      event: "started",
    });
    await step(token, {
      run: { key: "fix-login" },
      step: { id: "qa-1", agent: "qa" },
      event: "started",
    });
    await step(token, {
      run: { key: "fix-login" },
      step: { id: "qa-1", agent: "qa" },
      event: "finished",
    });
    return { w, agent };
  }

  const quietFor = (w: TestWorkspace, minutes: number) =>
    admin.query(
      `UPDATE nodrail.runs
       SET last_activity_at = now() - make_interval(mins => $2)
       WHERE workspace_id = $1`,
      [w.id, minutes],
    );

  test("are open steps in runs quiet for over an hour", async () => {
    const { w } = await runWithOpenStep();
    expect(await read(w.owner, w, stalledSteps)).toEqual([]);
    await quietFor(w, 59);
    expect(await read(w.owner, w, stalledSteps)).toEqual([]);
    await quietFor(w, 61);
    expect(await read(w.owner, w, stalledSteps)).toEqual([
      {
        runId: expect.any(String),
        runKey: "fix-login",
        stepKey: "dev-1",
        stepAgent: "dev",
        since: expect.any(String),
        lastActivityAt: expect.any(String),
      },
    ]);
  });

  test("are hidden from people who may not see the run's agent", async () => {
    const { w } = await runWithOpenStep();
    await quietFor(w, 90);
    const viewer = await addMember(w, "viewer");
    expect(await read(viewer, w, stalledSteps)).toEqual([]);
  });
});

describe("uncovered installations", () => {
  test("mostly asked for what no rule matched in the last week", async () => {
    const w = await createWorkspace();
    // Each agent starts with one action a rule denied.
    const uncovered = await createAgent(w, "uncovered");
    const covered = await createAgent(w, "covered");
    const even = await createAgent(w, "even");
    const quiet = await createAgent(w, "quiet");
    const old = await createAgent(w, "old");
    await actions(w, uncovered, { unmatched: 3 });
    await actions(w, covered, { matched: 3 });
    await actions(w, even, { unmatched: 2, matched: 1 });
    await actions(w, quiet, { unmatched: 1 });
    await admin.query(
      `UPDATE nodrail.action_requests
       SET created_at = now() - interval '8 days',
           expires_at = now() + interval '1 hour'
       WHERE agent_id = $1`,
      [old.id],
    );
    await actions(w, old, { unmatched: 3, daysAgo: 8 });
    expect(await read(w.owner, w, uncoveredInstallations)).toEqual([
      {
        agentKey: "uncovered",
        installationName: "uncovered-dev",
        actions: 4,
        uncovered: 3,
      },
    ]);
  });
});

describe("getHealth", () => {
  test("keeps a viewer to the agents assigned to them", async () => {
    const { w, person } = await assignedOne("viewer");
    await withWorkspace(w.owner, w.id, async (context) => {
      await pauseAgent(context, "mine");
      await pauseAgent(context, "theirs");
    });
    const health = await read(person, w, getHealth);
    expect(health.agents).toEqual({ connected: 1, reporting: 0, paused: 1 });
    expect(health.silent.map((item) => item.agentKey)).toEqual(["mine"]);
    expect(health.paused.map((item) => item.agentKey)).toEqual(["mine"]);
    const all = await read(w.owner, w, getHealth);
    expect(all.paused).toHaveLength(2);
  });

  test("lists reports of actions Nodrail never allowed, for those who may see them", async () => {
    const w = await createWorkspace();
    const agent = await createAgent(w, "bypass");
    const stray = await admin.transaction((manager) =>
      seedAction(manager, w, agent),
    );
    const reportOn = (actionId: string, outcome: string) =>
      admin.query(
        `INSERT INTO nodrail.client_reports
           (workspace_id, installation_id, action_request_id, client_report_key, outcome)
         VALUES ($1, $2, $3, gen_random_uuid()::text, $4)`,
        [w.id, agent.installationId, actionId, outcome],
      );
    // The world's own action was allowed by a rule: its report matches.
    await reportOn(agent.actionId, "success");
    await reportOn(stray.actionId, "failure");
    const health = await read(w.owner, w, getHealth);
    expect(health.mismatched).toEqual([
      {
        agentKey: "bypass",
        toolKey: "github",
        operationKey: "issues.delete",
        reportedAt: expect.any(String),
      },
    ]);
    const viewer = await addMember(w, "viewer");
    expect((await read(viewer, w, getHealth)).mismatched).toEqual([]);
  });

  test("answers NOT_FOUND for an environment that does not exist", async () => {
    const w = await createWorkspace();
    await expect(
      readWorkspace(w.owner, w.id, (context) => getHealth(context, "nope")),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
