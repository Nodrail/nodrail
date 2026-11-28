import "server-only";
import { randomUUID } from "node:crypto";
import { simulate, type PolicyDocument, type PolicyRule } from "@nodrail/sdk";
import { z } from "zod";
import { ruleInput } from "@/contracts/v1/policies";
import {
  IMPACT_DAYS,
  type ImpactChange,
  type ImpactDto,
} from "@/contracts/v1/policy-impact";
import { budgetInput, gateInput } from "@/contracts/v1/runs";
import {
  AppError,
  parseInput,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { ActivePolicy } from "@/server/db/entities";
import { cloudDocument, contractValues } from "@/server/modules/runs/contracts";
import { versionDocument } from "@/server/modules/runs/history";
import { findEnvironment } from "@/server/modules/workspaces";
import { resolveScope } from "./index";
import { recentActions, type RecentAction } from "./recent";

// What a rule, gate or budget would have done, before its form publishes it:
// the window's recorded actions decided again by the engine, once with the
// live policies and once with the form's entry in them.

/** What a form sends: the entry is checked by its own kind's schema later. */
const impactChange = z.strictObject({
  kind: z.enum(["rule", "gate", "budget"]),
  // An id as a policy document holds it, so editing replaces that entry.
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,62}$/)
    .nullable(),
  entry: z.unknown(),
});

type Entry = { id: string };
/** The document with the entry in it; for a rule, also the rule alone. */
type Next = {
  document: PolicyDocument;
  covers: PolicyDocument | null;
  id: string;
};
type Version2 = Extract<PolicyDocument, { version: 2 }>;

/** The live document as version 2, so a gate or budget can join it. */
const asVersion2 = (document: PolicyDocument): Version2 =>
  document.version === 2
    ? document
    : { ...document, version: 2, gates: [], budgets: [] };

/** The entries with this one in place of the one with its id, or added. */
function put<T extends Entry>(entries: T[], entry: T) {
  return entries.some((item) => item.id === entry.id)
    ? entries.map((item) => (item.id === entry.id ? entry : item))
    : [...entries, entry];
}

/** Agent and installation names as the stored document has them: ids. */
async function idsOf(
  context: WorkspaceContext,
  environmentId: string,
  names: { agentKey: string | null; installationName: string | null },
) {
  try {
    return await resolveScope(context, environmentId, names);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_INPUT")
      return null;
    throw error;
  }
}

async function withRule(
  context: WorkspaceContext,
  environmentId: string,
  live: PolicyDocument,
  change: ImpactChange,
): Promise<Next | null> {
  const parsed = ruleInput.safeParse(change.entry);
  if (!parsed.success) return null;
  const ids = await idsOf(context, environmentId, parsed.data);
  if (!ids) return null;
  const rule: PolicyRule = {
    ...parsed.data,
    id: change.id ?? randomUUID(),
    agentKey: ids.agentId,
    installationName: ids.installationId,
  };
  return {
    document: { ...live, rules: put(live.rules, rule) },
    covers: { version: 1, rules: [rule] } satisfies PolicyDocument,
    id: rule.id,
  };
}

async function withGate(
  context: WorkspaceContext,
  environmentId: string,
  live: PolicyDocument,
  change: ImpactChange,
): Promise<Next | null> {
  const parsed = gateInput.safeParse(change.entry);
  if (!parsed.success) return null;
  const ids = await idsOf(context, environmentId, {
    agentKey: parsed.data.agentKey,
    installationName: null,
  });
  if (!ids) return null;
  const document = asVersion2(live);
  const id = change.id ?? randomUUID();
  const before = document.gates.find((gate) => gate.id === id);
  // What the form doesn't show stays as the file wrote it.
  const gate = {
    installationName: before?.installationName ?? null,
    conditions: before?.conditions ?? [],
    expiresAt: before?.expiresAt ?? null,
    ...parsed.data,
    agentKey: ids.agentId,
    id,
  };
  return {
    document: { ...document, gates: put(document.gates, gate) },
    covers: null,
    id,
  };
}

function withBudget(live: PolicyDocument, change: ImpactChange): Next | null {
  const parsed = budgetInput.safeParse(change.entry);
  if (!parsed.success) return null;
  const document = asVersion2(live);
  const budget = { ...parsed.data, id: change.id ?? randomUUID() };
  return {
    document: { ...document, budgets: put(document.budgets, budget) },
    covers: null,
    id: budget.id,
  };
}

/** Whether the entry covers the action, as the engine matches it. */
function matches(
  kind: ImpactChange["kind"],
  next: Next,
  after: ReturnType<typeof simulate>,
  decide: (document: PolicyDocument) => ReturnType<typeof simulate>,
) {
  if (kind === "gate")
    return after.gates.some((gate) => gate.id === next.id && gate.applies);
  if (kind === "budget")
    return after.budgets.some(
      (budget) =>
        budget.id === next.id &&
        (budget.state === "over" || budget.state === "no_run"),
    );
  // A rule matches when, alone, it decides the action at all.
  return next.covers !== null && decide(next.covers).outcome !== "none";
}

/** The window's actions decided with and without the entry. */
function replay(
  kind: ImpactChange["kind"],
  live: PolicyDocument,
  next: Next,
  actions: RecentAction[],
) {
  const now = new Date();
  const counted = {
    matched: 0,
    changed: 0,
    runs: new Set<string>(),
    withoutRun: 0,
  };
  for (const action of actions) {
    // As Cloud decides: `where` on unreported values fails closed.
    const decide = (document: PolicyDocument) => {
      const cloud = cloudDocument(document);
      return simulate({
        document: cloud,
        descriptor: action.descriptor,
        now,
        run: action.run,
        values: contractValues(cloud, action.descriptor),
      });
    };
    const after = decide(next.document);
    if (!matches(kind, next, after, decide)) continue;
    counted.matched += 1;
    if (kind === "budget")
      if (action.runId) counted.runs.add(action.runId);
      else counted.withoutRun += 1;
    if (decide(live).outcome !== after.outcome) counted.changed += 1;
  }
  return counted;
}

/**
 * What one rule, gate or budget, as its form has it, would have matched in
 * the last days' actions, and how many it would have decided differently
 * than the policies live now. Null while the form is not a valid entry yet.
 */
export async function previewImpact(
  context: WorkspaceContext,
  environmentSlug: string,
  rawChange: ImpactChange,
): Promise<ImpactDto | null> {
  requireCapability(context, "policies:write");
  const change = parseInput(impactChange, rawChange);
  const { manager, workspaceId } = context;
  const { id: environmentId } = await findEnvironment(context, environmentSlug);
  const active = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId,
  });
  const live = await versionDocument(context, active.policyVersionId);
  const next =
    change.kind === "rule"
      ? await withRule(context, environmentId, live, change)
      : change.kind === "gate"
        ? await withGate(context, environmentId, live, change)
        : withBudget(live, change);
  if (!next) return null;
  const { actions, total } = await recentActions(
    context,
    environmentId,
    next.document.version === 2,
  );
  const counted = replay(change.kind, live, next, actions);
  return {
    days: IMPACT_DAYS,
    actions: actions.length,
    sampled: total > actions.length,
    matched: counted.matched,
    changed: counted.changed,
    runs: counted.runs.size,
    withoutRun: counted.withoutRun,
  };
}
