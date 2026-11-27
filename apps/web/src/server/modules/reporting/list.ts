import "server-only";
import { z } from "zod";
import { seesWholeWorkspace } from "@/contracts/v1/access";
import {
  DECISION_CHECKS,
  type DecisionCheck,
  type LocalRunDto,
  type ReportedDecisionDto,
} from "@/contracts/v1/reporting";
import {
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  localStepExchanges,
  localStepReceipts,
} from "@/server/modules/contracts/read";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * What installations reported their local hooks did, to read. Admins and
 * policy managers see everyone's; anyone else their own, as for the
 * inventory. Read only: these are evidence of local enforcement, never a
 * Cloud action or gate.
 */

const MAX_ROWS = 200;

const decisionRow = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  display_name: z.string(),
  machine: z.string().nullable(),
  project: z.string(),
  project_id: z.string().nullable(),
  host: z.string(),
  agent: z.string().nullable(),
  decision: z.enum(["allow", "deny", "would_deny"]),
  tool: z.string().nullable(),
  operation: z.string().nullable(),
  policy_revision: z.string().nullable(),
  run: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  occurred_at: z.date(),
  received_at: z.date(),
});

/** Who the person may see reports of: everyone, or themselves. */
async function scope(context: WorkspaceContext, environmentSlug: string) {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  return {
    params: [
      context.workspaceId,
      environment.id,
      seesWholeWorkspace(context.role),
      context.principal.userId,
    ],
    where: `e.workspace_id = $1 AND e.environment_id = $2 AND ($3 OR e.user_id = $4)`,
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

export async function listReportedDecisions(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<ReportedDecisionDto[]> {
  const { params, where } = await scope(context, environmentSlug);
  const rows = parseRows(
    decisionRow,
    await context.manager.query(
      `SELECT e.id, e.user_id, u.display_name, e.machine, e.project,
              e.project_id, e.host, e.agent, e.decision, e.tool, e.operation,
              e.policy_revision, e.run, e.details, e.occurred_at, e.received_at
       FROM nodrail.reported_events e
       JOIN nodrail.users u ON u.id = e.user_id
       WHERE ${where} AND e.kind = 'decision' AND e.source = 'local'
       ORDER BY e.occurred_at DESC, e.id
       LIMIT ${MAX_ROWS}`,
      params,
    ),
  );
  return rows.map((row) => ({
    id: row.id,
    person: row.display_name,
    mine: row.user_id === context.principal.userId,
    machine: row.machine?.slice(0, 8) ?? null,
    project: row.project,
    projectBound: row.project_id !== null,
    host: row.host,
    agent: row.agent,
    decision: row.decision,
    tool: row.tool,
    operation: row.operation,
    resourceKind: text(row.details.resourceKind),
    rule: text(row.details.rule),
    policyRevision: row.policy_revision,
    run: row.run,
    check: checkOf(row.details),
    occurredAt: row.occurred_at.toISOString(),
    receivedAt: row.received_at.toISOString(),
  }));
}

/** The brief or input check a decision reported (schema 3), as stored. */
function checkOf(details: Record<string, unknown>): DecisionCheck | null {
  for (const surface of ["brief", "input"] as const) {
    const state = text(details[`${surface}State`]);
    const contract = text(details[`${surface}Contract`]);
    const states: readonly string[] = DECISION_CHECKS[surface];
    if (state && contract && states.includes(state))
      return { surface, state: state as DecisionCheck["state"], contract };
  }
  return null;
}

const runEventRow = z.object({
  source: z.string(),
  user_id: z.uuid(),
  project_id: z.uuid().nullable(),
  machine: z.string().nullable(),
  display_name: z.string(),
  project: z.string(),
  host: z.string(),
  run: z.string(),
  run_event: z.enum(["step.started", "step.finished", "action"]),
  step: z.string().nullable(),
  agent: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  occurred_at: z.date(),
});

type RunEventRow = z.infer<typeof runEventRow>;
type Step = LocalRunDto["steps"][number];

const number = (value: unknown) => (typeof value === "number" ? value : null);

/** A step from its start and finish, whichever arrived; unknown stays null. */
function stepFrom(step: Step | undefined, row: RunEventRow): Step {
  const known: Step = step ?? {
    step: row.step ?? "",
    agent: row.agent ?? "",
    startedAt: null,
    finishedAt: null,
    verdict: null,
    findings: null,
    tokens: null,
    usd: null,
    receipt: null,
    receiptState: null,
    receiptContract: null,
    exchanges: [],
  };
  const at = row.occurred_at.toISOString();
  if (row.run_event === "step.started")
    return { ...known, startedAt: known.startedAt ?? at };
  return {
    ...known,
    finishedAt: at,
    verdict: text(row.details.verdict) ?? known.verdict,
    findings: number(row.details.findings) ?? known.findings,
    tokens: number(row.details.tokens) ?? known.tokens,
    usd: number(row.details.usd) ?? known.usd,
    receiptState:
      (text(row.details.receiptState) as Step["receiptState"]) ??
      known.receiptState,
    receiptContract: text(row.details.receiptContract) ?? known.receiptContract,
  };
}

function runFrom(rows: RunEventRow[], userId: string): LocalRunDto {
  const first = rows[0]!;
  const steps = new Map<string, Step>();
  const actions = { allowed: 0, denied: 0, other: 0 };
  for (const row of rows) {
    if (row.run_event === "action") {
      const outcome = text(row.details.outcome);
      if (outcome === "allow") actions.allowed++;
      else if (outcome === "deny") actions.denied++;
      else actions.other++;
    } else if (row.step)
      steps.set(row.step, stepFrom(steps.get(row.step), row));
  }
  return {
    id: first.source,
    run: first.run,
    project: first.project,
    projectBound: first.project_id !== null,
    machine: first.machine,
    host: first.host,
    person: first.display_name,
    mine: first.user_id === userId,
    startedAt: first.occurred_at.toISOString(),
    lastAt: rows.at(-1)!.occurred_at.toISOString(),
    steps: [...steps.values()],
    actions,
  };
}

/**
 * Where a run's events come from, as SQL: the person, the project (its
 * stable id, or its name when unbound), the machine and the run's hashed
 * key. The same key in two projects or on two machines is two runs: their
 * ledgers are apart, and an equal hash says nothing more.
 */
const RUN_SOURCE = `concat_ws('/', e.user_id,
  coalesce(e.project_id::text, 'unbound:' || e.project),
  coalesce(e.machine, '-'), e.run)`;

/**
 * Local runs, newest first: each run's steps and the actions taken in it,
 * by when they happened. A duplicate never adds a step; an event that
 * arrived late still lands in its place.
 */
export async function listLocalRuns(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<LocalRunDto[]> {
  const { params, where } = await scope(context, environmentSlug);
  const rows = parseRows(
    runEventRow,
    await context.manager.query(
      `SELECT md5(${RUN_SOURCE}) AS source, e.user_id, e.project_id, e.machine,
              u.display_name, e.project, e.host, e.run, e.run_event,
              e.step, e.agent, e.details, e.occurred_at
       FROM nodrail.reported_events e
       JOIN nodrail.users u ON u.id = e.user_id
       WHERE ${where} AND e.kind = 'run.event' AND e.source = 'local'
         AND ${RUN_SOURCE} IN (
           SELECT ${RUN_SOURCE} FROM nodrail.reported_events e
           WHERE ${where} AND e.kind = 'run.event' AND e.source = 'local'
           GROUP BY 1 ORDER BY max(occurred_at) DESC LIMIT 50)
       ORDER BY e.occurred_at, e.id
       LIMIT 5000`,
      params,
    ),
  );
  const runs = new Map<string, RunEventRow[]>();
  for (const row of rows)
    runs.set(row.source, [...(runs.get(row.source) ?? []), row]);
  const sources = [...runs.keys()];
  const receipts = await localStepReceipts(
    context,
    environmentSlug,
    RUN_SOURCE,
    sources,
  );
  const exchanges = await localStepExchanges(
    context,
    environmentSlug,
    RUN_SOURCE,
    sources,
  );
  return [...runs.values()]
    .map((events) => runFrom(events, context.principal.userId))
    .map((run) => ({
      ...run,
      steps: run.steps.map((step) => ({
        ...step,
        receipt: receipts.get(`${run.id}/${step.step}`) ?? null,
        exchanges: exchanges.get(`${run.id}/${step.step}`) ?? [],
      })),
    }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}
