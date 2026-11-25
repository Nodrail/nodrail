import "server-only";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import type { PolicyDocument } from "@nodrail/policy-engine";
import type { RunPolicy } from "@/server/modules/runs/history";

// Gates and budgets of a rules file, as a policy version stores them.

export type Issue = { line: number; column: number; message: string };
export type Targets = {
  agents: Map<string, string>;
  installations: Map<string, { id: string; agent_id: string }>;
};

/** A rule's or gate's agent and installation by id, or why they aren't here. */
export function resolveNames(
  found: Targets,
  item: { agentKey: string | null; installationName: string | null },
  line: number,
  issues: Issue[],
) {
  const agentId = item.agentKey ? found.agents.get(item.agentKey) : null;
  const installation = item.installationName
    ? found.installations.get(item.installationName)
    : null;
  if (agentId === undefined)
    issues.push({
      line,
      column: 1,
      message: `No agent called "${item.agentKey}".`,
    });
  if (
    installation === undefined ||
    (installation && installation.agent_id !== agentId)
  )
    issues.push({
      line,
      column: 1,
      message: `No installation "${item.installationName}" for that agent here.`,
    });
  return { agentId: agentId ?? null, installationId: installation?.id ?? null };
}

/**
 * Gates and budgets as the version stores them: ids stable like rule ids, and
 * agents and installations by id. Compared entry by entry with the live ones.
 */
export function planRunPolicy(
  document: PolicyDocument,
  idFor: (id: string) => string,
  found: Targets,
  current: RunPolicy | null,
) {
  const issues: Issue[] = [];
  if (document.version === 1)
    return { runPolicy: null, issues, ...diffEntries([], current) };
  const gates = document.gates.map((gate) => {
    const { agentId, installationId } = resolveNames(found, gate, 1, issues);
    const id = idFor(gate.id);
    return { ...gate, id, agentKey: agentId, installationName: installationId };
  });
  const budgets = document.budgets.map((budget) => ({
    ...budget,
    id: idFor(budget.id),
  }));
  const runPolicy: RunPolicy =
    document.version === 4
      ? {
          gates,
          budgets,
          ...contractsOf(document, idFor),
          ...accountableOf(document, idFor),
        }
      : document.version === 3
        ? { gates, budgets, ...contractsOf(document, idFor) }
        : { gates, budgets };
  return {
    runPolicy,
    issues,
    ...diffEntries(entriesOf(runPolicy), current),
  };
}

type Accountable = Extract<PolicyDocument, { version: 4 }>;

/**
 * What only a version 4 document has, kept whole too: its numeric budgets
 * by logical id like the others, and the evidence contracts its gates'
 * `evidence` requirements read (those stay on each gate).
 */
function accountableOf(
  document: Accountable,
  idFor: (id: string) => string,
): Pick<RunPolicy, "limits" | "evidence"> {
  return {
    limits: document.limits.map((limit) => ({ ...limit, id: idFor(limit.id) })),
    evidence: document.evidence,
  };
}

/**
 * What a version 3 or 4 document declares besides gates and budgets, kept
 * whole: receipts, briefs and operation inputs, and each rule's `where`
 * by its logical id. Briefs and inputs only when declared.
 */
function contractsOf(
  document: Extract<PolicyDocument, { version: 3 | 4 }>,
  idFor: (id: string) => string,
): Omit<RunPolicy, "gates" | "budgets"> {
  const where = Object.fromEntries(
    document.rules.flatMap((rule) =>
      rule.where?.length ? [[idFor(rule.id), rule.where]] : [],
    ),
  );
  return {
    receipts: document.receipts,
    ...(document.briefs ? { briefs: document.briefs } : {}),
    ...(document.inputs ? { inputs: document.inputs } : {}),
    ...(Object.keys(where).length ? { where } : {}),
  };
}

/** One declared contract as an entry a plan lists. */
const contractEntries = (
  contracts: Record<string, unknown> | undefined,
  kind: string,
  label: (key: string) => string,
) =>
  Object.entries(contracts ?? {}).map(([key, contract]) => ({
    id: `${kind}:${key}`,
    name: label(key),
    contract,
  }));

/**
 * Gates, budgets and declared contracts as entries a plan lists: a receipt,
 * brief or input contract that changes is a change to the version, gates
 * or not. A rule's `where` changes the rule itself (see planRules).
 */
function entriesOf(policy: RunPolicy | null) {
  if (!policy) return [];
  return [
    ...policy.gates,
    ...policy.budgets,
    ...(policy.limits ?? []),
    ...contractEntries(
      policy.evidence,
      "evidence",
      (name) => `${name}'s evidence contract`,
    ),
    ...contractEntries(
      policy.receipts,
      "receipt",
      (agent) => `${agent}'s receipt contract`,
    ),
    ...contractEntries(
      policy.briefs,
      "brief",
      (agent) => `${agent}'s brief contract`,
    ),
    ...contractEntries(
      policy.inputs,
      "input",
      (operation) => `${operation}'s input contract`,
    ),
  ];
}

function diffEntries(
  next: { id: string; name: string }[],
  current: RunPolicy | null,
) {
  const was = entriesOf(current);
  const before = new Map(was.map((entry) => [entry.id, fingerprint(entry)]));
  const kept = new Set(next.map((entry) => entry.id));
  const names = (entries: { name: string }[]) => entries.map((e) => e.name);
  return {
    added: names(next.filter((entry) => !before.has(entry.id))),
    changed: names(
      next.filter(
        (entry) =>
          before.has(entry.id) && before.get(entry.id) !== fingerprint(entry),
      ),
    ),
    removed: names(was.filter((entry) => !kept.has(entry.id))),
  };
}
