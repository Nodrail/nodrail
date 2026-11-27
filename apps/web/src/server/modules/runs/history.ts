import "server-only";
import {
  MAIN_AGENT,
  simulate,
  type Descriptor,
  type PolicyBudget,
  type PolicyDocument,
  type PolicyGate,
  type RunContext,
  type RunEvent,
  type SimulationResult,
} from "@nodrail/policy-engine";
import type {
  BriefContract,
  CompiledCondition,
  InputContract,
  ReceiptContract,
} from "@nodrail/policy-engine/contracts";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import { standingDto } from "@/contracts/v1/budgets";
import {
  admit,
  withLimits,
  type Admission,
} from "@/server/modules/budgets/reserve";
import type { RequirementStatusDto, RunHoldDto } from "@/contracts/v1/runs";
import type { Condition, ResourceScope } from "@/contracts/v1/policies";
import { AppError, parseRows } from "@/server/db/context";
import { PolicyRule, PolicyVersion } from "@/server/db/entities";
import { cloudDocument, contractValues, decideHandback } from "./contracts";
import { gateRequirements } from "./requirements";

type Scope = { manager: EntityManager; workspaceId: string };

/** A receipt read against its declared contract, as a run event carries it. */
export type ReceiptRecord = NonNullable<
  Extract<RunEvent, { type: "step.finished" }>["receipt"]
>;

/**
 * What a version stores besides its rules. Agents and installations by id.
 * `receipts`, from a rules file with declared contracts (document version
 * 3): each agent's receipt contract, pinned by its digest, as the engine
 * compiled it. Cloud reads a step's receipt with it and gates check it.
 */
export type RunPolicy = {
  gates: PolicyGate[];
  budgets: PolicyBudget[];
  receipts?: Record<string, ReceiptContract>;
  /** By agent, when the file declares briefs. */
  briefs?: Record<string, BriefContract>;
  /** By `<tool>.<operation>`, when the file declares operation inputs. */
  inputs?: Record<string, InputContract>;
  /** Each rule's typed `where`, by logical rule id: a rule row has no place for it. */
  where?: Record<string, CompiledCondition[]>;
} & Partial<
  /**
   * From a document version 4 (engine level 5), kept whole: numeric budgets
   * (`limits`, by logical id) and the evidence contracts gates' `evidence`
   * requirements read. A version stores them exactly when it was version 4.
   */
  Pick<Extract<PolicyDocument, { version: 4 }>, "limits" | "evidence">
>;

/** A stored rule as the engine reads it. Agents and installations are ids. */
export const toPolicyRule = (rule: PolicyRule) => ({
  id: rule.logicalRuleId,
  name: rule.name,
  effect: rule.effect,
  agentKey: rule.agentId,
  installationName: rule.installationId,
  toolKey: rule.toolKey,
  operationKey: rule.operationKey,
  resource: rule.resourceScope as ResourceScope,
  conditions: rule.conditions as Condition[],
  expiresAt: rule.expiresAt?.toISOString() ?? null,
});

/**
 * The gates and budgets a version decides with. The one place a version's
 * document version is resolved: with `NODRAIL_RUN_POLICY_DISABLED=1` every
 * version decides as document version 1, rules alone, and runs are recorded
 * without locking. An operator's switch for an incident; see the README.
 */
export function liveRunPolicy(stored: unknown): RunPolicy | null {
  if (process.env.NODRAIL_RUN_POLICY_DISABLED === "1") return null;
  return (stored as RunPolicy | null) ?? null;
}

/**
 * A version's run policy as one engine document: version 4 with numeric
 * budgets or evidence, version 3 with declared receipts, else version 2. A
 * gate added later without contract fields (from a form) is read as the
 * engine compiles one: pinned to its agent's receipt contract, with no
 * conditions.
 */
function runDocument(
  base: { rules: PolicyDocument["rules"] },
  live: RunPolicy,
): PolicyDocument {
  const { receipts, gates, budgets, briefs, inputs, where } = live;
  const { limits, evidence } = live;
  const accountable = limits !== undefined || evidence !== undefined;
  if (!receipts && !accountable) return { version: 2, ...base, gates, budgets };
  const pinned = receipts ?? {};
  const contracts = {
    rules: base.rules.map((rule) => {
      const conditions = where?.[rule.id];
      return conditions ? { ...rule, where: conditions } : rule;
    }),
    budgets,
    receipts: pinned,
    ...(briefs ? { briefs } : {}),
    ...(inputs ? { inputs } : {}),
    gates: gates.map((gate) => ({
      ...gate,
      requires: gate.requires.map((need) => ({
        where: [],
        authority: "agent-reported" as const,
        subject: null,
        ...need,
        contract: pinned[need.agent]?.contract ?? null,
      })),
    })),
  };
  if (!accountable) return { version: 3, ...contracts };
  return {
    version: 4,
    ...contracts,
    limits: limits ?? [],
    evidence: evidence ?? {},
  };
}

/** A version as one engine document: version 1 without gates or budgets. */
export async function versionDocument(
  { manager, workspaceId }: Scope,
  policyVersionId: string,
): Promise<PolicyDocument> {
  const rules = await manager.findBy(PolicyRule, {
    workspaceId,
    policyVersionId,
  });
  const { runPolicy } = await manager.findOneByOrFail(PolicyVersion, {
    workspaceId,
    id: policyVersionId,
  });
  const base = { rules: rules.map(toPolicyRule) };
  const live = liveRunPolicy(runPolicy);
  return live ? runDocument(base, live) : { version: 1, ...base };
}

/**
 * The live version's run policy in an environment, or null without one.
 * Decisions read run history only with one, so only then is a run locked
 * while an event is recorded; see `enterRun`.
 */
export async function liveRunPolicyIn(
  { manager, workspaceId }: Scope,
  environmentId: string,
) {
  const [row]: { run_policy: unknown }[] = await manager.query(
    `SELECT pv.run_policy FROM nodrail.active_policies ap
     JOIN nodrail.policy_versions pv
       ON pv.workspace_id = ap.workspace_id AND pv.id = ap.policy_version_id
     WHERE ap.workspace_id = $1 AND ap.environment_id = $2`,
    [workspaceId, environmentId],
  );
  return liveRunPolicy(row?.run_policy);
}

/** Past this, a run is too long to decide on; the integration starts another. */
export const MAX_EVENTS = 20_000;

const eventRow = z.object({
  kind: z.enum(["started", "action", "finished"]),
  at: z.date(),
  step_key: z.string().nullable(),
  agent: z.string().nullable(),
  verdict: z.string().nullable(),
  receipt: z
    .object({
      findings: z.array(z.string()).optional(),
      usage: z
        .object({ tokens: z.number().optional(), usd: z.number().optional() })
        .optional(),
      /** Read against a declared receipt contract, as the engine records it. */
      contract: z.custom<ReceiptRecord>().optional(),
    })
    .nullable(),
  tool_key: z.string().nullable(),
  operation_key: z.string().nullable(),
  initial_evaluation: z.string().nullable(),
  change: z.boolean().nullable(),
});

const outcomeOf: Record<
  string,
  Extract<RunEvent, { type: "action" }>["outcome"]
> = {
  ready: "allow",
  denied: "deny",
};

function toEvent(row: z.infer<typeof eventRow>): RunEvent {
  const at = row.at.toISOString();
  const agent = row.agent ?? MAIN_AGENT;
  if (row.kind === "action")
    return {
      type: "action",
      step: row.step_key,
      agent,
      at,
      tool: row.tool_key ?? "",
      operation: row.operation_key ?? "",
      outcome: outcomeOf[row.initial_evaluation ?? ""] ?? "none",
      change: row.change === true,
    };
  const step = row.step_key ?? "";
  if (row.kind === "started") return { type: "step.started", step, agent, at };
  return {
    type: "step.finished",
    step,
    agent,
    at,
    verdict: row.verdict,
    findings: row.receipt?.findings ?? [],
    usage: row.receipt?.usage ?? {},
    ...(row.receipt?.contract ? { receipt: row.receipt.contract } : {}),
  };
}

/**
 * Everything recorded in a run, in the order it was recorded: by its place in
 * the run, never by a clock. Deciding an action that is already recorded
 * counts only the actions before it, and every step up to now.
 */
export async function runEvents(
  { manager, workspaceId }: Scope,
  runId: string,
  beforeActionId: string | null = null,
): Promise<RunEvent[]> {
  const rows = parseRows(
    eventRow,
    await manager.query(
      `SELECT kind, at, step_key, agent, verdict, receipt, tool_key,
              operation_key, initial_evaluation, change
       FROM (
         SELECT 'started' AS kind, s.started_seq AS seq, s.started_at AS at,
                s.step_key, s.agent, NULL AS verdict, NULL::jsonb AS receipt,
                NULL AS tool_key, NULL AS operation_key,
                NULL AS initial_evaluation, NULL::boolean AS change
         FROM nodrail.run_steps s
         WHERE s.workspace_id = $1 AND s.run_id = $2 AND s.started_seq IS NOT NULL
         UNION ALL
         SELECT 'finished', s.finished_seq, s.finished_at, s.step_key, s.agent,
                s.verdict, s.receipt, NULL, NULL, NULL, NULL
         FROM nodrail.run_steps s
         WHERE s.workspace_id = $1 AND s.run_id = $2 AND s.finished_seq IS NOT NULL
         UNION ALL
         -- A change counts once it went ahead: once it was given its permit,
         -- or, decided on its host, once the host allowed it.
         SELECT 'action', ar.run_seq, ar.created_at, ar.step_key,
                CASE WHEN to_jsonb(i)->>'enrollment_project_id' IS NULL THEN s.agent ELSE a.external_key END, NULL,
                NULL, ar.tool_key, ar.operation_key, ar.initial_evaluation,
                ar.run_change AND (
                  (ar.decided_by = 'host' AND ar.initial_evaluation = 'ready')
                  OR EXISTS (
                    SELECT 1 FROM nodrail.decision_permits p
                    WHERE p.workspace_id = ar.workspace_id
                      AND p.action_request_id = ar.id))
         FROM nodrail.action_requests ar
         JOIN nodrail.installations i ON i.workspace_id = ar.workspace_id AND i.id = ar.installation_id
         JOIN nodrail.agents a ON a.workspace_id = ar.workspace_id AND a.id = ar.agent_id
         LEFT JOIN nodrail.run_steps s
           ON s.workspace_id = ar.workspace_id AND s.run_id = ar.run_id
          AND s.step_key = ar.step_key
         WHERE ar.workspace_id = $1 AND ar.run_id = $2 AND ar.access_epoch <> 0
           AND ($3::uuid IS NULL OR ar.run_seq < (
             SELECT run_seq FROM nodrail.action_requests
             WHERE workspace_id = $1 AND id = $3))
       ) events
       ORDER BY seq
       LIMIT ${MAX_EVENTS}`,
      [workspaceId, runId, beforeActionId],
    ),
  );
  if (rows.length >= MAX_EVENTS) throw new AppError("RUN_TOO_LONG");
  return rows.map(toEvent);
}

/** Where an action sits: its run's key and the step taking it. */
export type Place = {
  runId: string;
  key: string;
  step: { id: string; agent: string } | null;
};

/**
 * The run an already recorded action belongs to, or null. Locked while the
 * decision reads its history, when decisions read history at all.
 */
export async function placeOf(
  { manager, workspaceId }: Scope,
  actionId: string,
  lock: boolean,
): Promise<Place | null> {
  const [row]: {
    run_id: string;
    key: string;
    step_key: string | null;
    agent: string | null;
  }[] = await manager.query(
    `SELECT r.id AS run_id, r.key, ar.step_key, s.agent
     FROM nodrail.action_requests ar
     JOIN nodrail.runs r ON r.workspace_id = ar.workspace_id AND r.id = ar.run_id
     LEFT JOIN nodrail.run_steps s
       ON s.workspace_id = ar.workspace_id AND s.run_id = ar.run_id
      AND s.step_key = ar.step_key
     WHERE ar.workspace_id = $1 AND ar.id = $2
       AND r.installation_id = ar.installation_id
     ${lock ? "FOR UPDATE OF r" : ""}`,
    [workspaceId, actionId],
  );
  if (!row) return null;
  return {
    runId: row.run_id,
    key: row.key,
    step:
      row.step_key && row.agent ? { id: row.step_key, agent: row.agent } : null,
  };
}

/**
 * The one decision, for submitting, permitting and re-checking after a
 * publish: the engine, the version's document as Cloud may read it (a
 * `where` on a value it never sees fails closed), the values the action
 * carries, and the run's own history. A hand-back is decided as the local
 * hook decides it. In an environment (`scope.environmentId`), also Cloud's
 * count of each numeric budget covering the call; `lockBudgets` (the
 * permit) locks their windows first, after the action and its run.
 */
export async function decideInRun(
  scope: Scope & { environmentId?: string },
  input: {
    document: PolicyDocument;
    descriptor: Descriptor;
    place: Place | null;
    beforeActionId?: string;
    lockBudgets?: boolean;
  },
): Promise<RunVerdict> {
  const verdict = await decideRules(scope, input);
  const { environmentId } = scope;
  if (environmentId === undefined) return verdict;
  const { toolKey: tool, operationKey: operation, params } = input.descriptor;
  const admission = await admit(
    { manager: scope.manager, workspaceId: scope.workspaceId, environmentId },
    {
      document: input.document,
      descriptor: { tool, operation, params },
      place: input.place,
      lock: input.lockBudgets ?? false,
    },
  );
  return { ...withLimits(verdict, admission.standings), admission };
}

async function decideRules(
  scope: Scope,
  input: {
    document: PolicyDocument;
    descriptor: Descriptor;
    place: Place | null;
    beforeActionId?: string;
  },
): Promise<RunVerdict> {
  const { descriptor, place } = input;
  const document = cloudDocument(input.document);
  // Rules alone never read history, so a version 1 document skips it.
  const run: RunContext | null =
    place && document.version !== 1
      ? {
          run: place.key,
          step: place.step,
          events: await runEvents(scope, place.runId, input.beforeActionId),
        }
      : null;
  // Numeric budgets are counted by Cloud's own ledger (budgets/reserve.ts),
  // never by the engine here: it has no ledger, so it would hold them all.
  const decided =
    document.version === 4 ? { ...document, limits: [] } : document;
  const result = decideHandback(
    simulate({
      document: decided,
      descriptor,
      now: new Date(),
      run,
      values: contractValues(document, descriptor),
    }),
    { document, descriptor, run },
  );
  return { ...result, requirements: gateRequirements(document, result, run) };
}

/** The engine's decision, and how each requirement of a holding gate stood. */
export type RunVerdict = SimulationResult & {
  requirements?: RequirementStatusDto[];
  /** The numeric budgets counted, and the windows a permit locked. */
  admission?: Admission;
};

/** What a gate or budget held back, kept with the action and shown to people. */
export function holdOf(result: RunVerdict): RunHoldDto | null {
  if (result.reason === "gate") {
    const gate = result.gates.find(({ id }) => id === result.matchedRuleId);
    if (!gate) return null;
    const { id, name, missing } = gate;
    const { explanation, requirements } = result;
    return {
      kind: "gate",
      id,
      name,
      explanation,
      missing,
      ...(requirements ? { requirements } : {}),
    };
  }
  if (result.reason === "budget") {
    const budget = result.budgets.find(({ id }) => id === result.matchedRuleId);
    const limit = result.limits?.find(({ id }) => id === result.matchedRuleId);
    const held = budget ?? limit;
    if (!held) return null;
    const { id, name } = held;
    return {
      kind: "budget",
      id,
      name,
      explanation: result.explanation,
      missing: [],
      ...(limit && !budget ? { limit: standingDto(limit) } : {}),
    };
  }
  return null;
}
