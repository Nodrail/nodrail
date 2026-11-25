import "server-only";
import { z } from "zod";
import { decidedOnHost } from "@/contracts/v1/runs";
import type {
  RunActionDto,
  RunDetailDto,
  RunEntryDto,
  RunHoldDto,
  RunStepDto,
} from "@/contracts/v1/runs";
import { parseRows, type WorkspaceContext } from "@/server/db/context";
import { runExchanges } from "@/server/modules/contracts/read";
import { getRunSummary } from "./summary";

/** A timeline longer than this shows its latest entries. */
const TIMELINE_LIMIT = 500;

export { getRunSummary, listHeldRuns, listRuns } from "./summary";

const stepRow = z.object({
  step_key: z.string(),
  agent: z.string(),
  installation_name: z.string(),
  started_at: z.date().nullable(),
  finished_at: z.date().nullable(),
  verdict: z.string().nullable(),
  receipt: z.object({ findings: z.array(z.string()).optional() }),
  started_seq: z.string().nullable(),
  finished_seq: z.string().nullable(),
});

const toStep = (row: z.infer<typeof stepRow>): RunStepDto => ({
  stepKey: row.step_key,
  agent: row.agent,
  installationName: row.installation_name,
  startedAt: row.started_at?.toISOString() ?? null,
  finishedAt: row.finished_at?.toISOString() ?? null,
  verdict: row.verdict,
  findings: row.receipt.findings ?? [],
});

async function loadSteps(context: WorkspaceContext, runId: string) {
  const rows = parseRows(
    stepRow,
    await context.manager.query(
      `SELECT s.step_key, s.agent, i.name AS installation_name, s.started_at,
              s.finished_at, s.verdict, s.receipt, s.started_seq::text,
              s.finished_seq::text
       FROM nodrail.run_steps s
       JOIN nodrail.installations i
         ON i.workspace_id = s.workspace_id AND i.id = s.installation_id
       WHERE s.workspace_id = $1 AND s.run_id = $2`,
      [context.workspaceId, runId],
    ),
  );
  return rows.map((row) => ({
    step: toStep(row),
    started: row.started_seq,
    finished: row.finished_seq,
  }));
}

const actionRow = z.object({
  id: z.uuid(),
  run_seq: z.string(),
  created_at: z.date(),
  step_key: z.string().nullable(),
  agent: z.string().nullable(),
  tool_key: z.string(),
  operation_key: z.string(),
  resource_id: z.string(),
  initial_evaluation: z.custom<RunActionDto["evaluation"]>(),
  run_hold: z.custom<RunHoldDto>().nullable(),
  event_id: z.uuid().nullable(),
  action_digest: z.string(),
  decided_on_host: z.boolean(),
  policy_digest: z.string().nullable(),
  policy_skew: z.boolean().nullable(),
});

async function loadActions(context: WorkspaceContext, runId: string) {
  const rows = parseRows(
    actionRow,
    await context.manager.query(
      `SELECT ar.id, ar.run_seq::text, ar.created_at, ar.step_key, s.agent, ar.tool_key,
              ar.operation_key, ar.resource_id, ar.initial_evaluation,
              ar.run_hold, ar.action_digest, ar.policy_digest, ar.policy_skew,
              ar.decided_by = 'host' AS decided_on_host,
              -- Its event in Activity: the latest decision recorded about it.
              (SELECT e.id FROM nodrail.audit_events e
               WHERE e.workspace_id = ar.workspace_id
                 AND e.action_request_id = ar.id
               ORDER BY e.occurred_at DESC, e.id DESC
               LIMIT 1) AS event_id
       FROM nodrail.action_requests ar
       LEFT JOIN nodrail.run_steps s
         ON s.workspace_id = ar.workspace_id AND s.run_id = ar.run_id
        AND s.step_key = ar.step_key
       WHERE ar.workspace_id = $1 AND ar.run_id = $2
       ORDER BY ar.run_seq DESC
       LIMIT ${TIMELINE_LIMIT}`,
      [context.workspaceId, runId],
    ),
  );
  return rows.map((row) => ({
    seq: row.run_seq,
    action: toAction(row),
    digest: row.action_digest,
  }));
}

function toAction(row: z.infer<typeof actionRow>): RunActionDto {
  return {
    id: row.id,
    at: row.created_at.toISOString(),
    stepKey: row.step_key,
    agent: row.agent ?? "main",
    toolKey: row.tool_key,
    operationKey: row.operation_key,
    resource: row.resource_id,
    evaluation: row.initial_evaluation,
    hold: row.run_hold,
    eventId: row.event_id,
    ...decidedOnHost(row),
  };
}

type Placed = { seq: string; entry: RunEntryDto };

/** Steps starting and finishing, and actions, in the order they were recorded. */
function timelineOf(
  steps: Awaited<ReturnType<typeof loadSteps>>,
  actions: Awaited<ReturnType<typeof loadActions>>,
) {
  const placed: Placed[] = [
    ...steps.flatMap(({ step, started, finished }) => [
      ...(started && step.startedAt
        ? [
            {
              seq: started,
              entry: { kind: "started" as const, at: step.startedAt, step },
            },
          ]
        : []),
      ...(finished && step.finishedAt
        ? [
            {
              seq: finished,
              entry: { kind: "finished" as const, at: step.finishedAt, step },
            },
          ]
        : []),
    ]),
    ...actions.map(({ seq, action }) => ({
      seq,
      entry: { kind: "action" as const, at: action.at, action },
    })),
  ];
  const order = (a: Placed, b: Placed) => {
    const diff = BigInt(a.seq) - BigInt(b.seq);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  };
  return placed
    .sort(order)
    .slice(-TIMELINE_LIMIT)
    .map(({ entry }) => entry);
}

/** One run with its timeline. Hidden unless the database shows it to this person. */
export async function getRun(
  context: WorkspaceContext,
  environmentSlug: string,
  runId: string,
): Promise<RunDetailDto> {
  const summary = await getRunSummary(context, environmentSlug, runId);
  const [steps, actions] = [
    await loadSteps(context, runId),
    await loadActions(context, runId),
  ];
  const exchanges = await runExchanges(context, environmentSlug, runId);
  const digests = new Map(
    actions.map(({ action, digest }) => [action.id, digest]),
  );
  // Each exchange once: an action's with it, a step's where it started.
  const timeline = timelineOf(steps, actions).map((entry): RunEntryDto => {
    const found =
      entry.kind === "action"
        ? exchanges.get(`action:${digests.get(entry.action.id)}`)
        : entry.kind === "started"
          ? exchanges.get(`step:${entry.step.stepKey}`)
          : undefined;
    if (!found) return entry;
    return entry.kind === "action"
      ? { ...entry, action: { ...entry.action, exchanges: found } }
      : { ...entry, step: { ...entry.step, exchanges: found } };
  });
  return { ...summary, timeline };
}
