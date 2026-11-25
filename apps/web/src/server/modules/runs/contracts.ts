import "server-only";
import {
  hasContracts,
  type Descriptor,
  type PolicyDocument,
  type RunContext,
  type SimulationInput,
  type SimulationResult,
} from "@nodrail/policy-engine";
import { HANDBACK_ACTION } from "@nodrail/policy-engine/hook-runs";
import {
  PAYLOAD_BYTES,
  checkValue,
  projectShape,
  type CompiledCondition,
  type ResolvedProperty,
  type ResolvedShape,
} from "@/contracts/v1/shapes-engine";

/**
 * Declared contracts where Cloud decides: `where`
 * on a call's input or a started agent's brief, read only from the fields
 * the contract reports, and a subagent's hand-back. Cloud never sees a
 * value the projection withholds, so a `where` that reads one is unmet
 * here: an allow with it never matches, a deny or review with it applies,
 * as the engine treats a call it has no checked values for.
 */

type V3 = Extract<PolicyDocument, { version: 3 | 4 }>;
type Values = NonNullable<SimulationInput["values"]>;
type WithWhere = {
  effect: string;
  toolKey: string;
  operationKey: string;
  resource: { kind: string; match: string; value?: string | null };
  where?: CompiledCondition[];
};

/** The brief contract a rule on starting one agent reads, by its resource. */
const briefOfRule = (document: V3, rule: WithWhere) =>
  rule.resource.kind === "agent" &&
  rule.resource.match === "exact" &&
  typeof rule.resource.value === "string"
    ? document.briefs?.[rule.resource.value]
    : undefined;

const inputOf = (document: V3, tool: string, operation: string) =>
  document.inputs?.[`${tool}.${operation}`];

/** Whether a path names a property the projected shape keeps. Lists are never entered. */
function reportedAt(shape: ResolvedShape, path: string[]) {
  let properties: Record<string, ResolvedProperty> | null = shape.properties;
  for (const part of path) {
    const property: ResolvedProperty | undefined = properties?.[part];
    if (!property) return false;
    properties = property.type === "object" ? property.properties : null;
  }
  return path.length > 0;
}

/** The shape a `where` root reads for this rule, as Cloud may see it. */
function reportedShape(document: V3, rule: WithWhere, root: string) {
  const contract =
    root === "brief"
      ? briefOfRule(document, rule)
      : root === "input"
        ? inputOf(document, rule.toolKey, rule.operationKey)
        : undefined;
  return contract ? projectShape(contract.shape).shape : null;
}

/** The paths of a rule's `where` that Cloud never sees, as written (`input.card`). */
export function unreportedPaths(document: PolicyDocument, rule: WithWhere) {
  if (!hasContracts(document) || !rule.where?.length) return [];
  return rule.where
    .filter(({ path: [root, ...rest] }) => {
      const shape = root ? reportedShape(document, rule, root) : null;
      return !shape || !reportedAt(shape, rest);
    })
    .map(({ path }) => path.join("."));
}

/**
 * A rule or gate as Cloud decides it: unchanged unless its `where` reads a
 * path the contract doesn't report. Then an allow is dropped (it never
 * matches) and a deny, review or gate loses its `where` (it applies).
 */
function failClosed<T extends WithWhere>(
  document: PolicyDocument,
  rule: T,
): T | null {
  if (!unreportedPaths(document, rule).length) return rule;
  if (rule.effect === "allow") return null;
  const { where: _unread, ...applies } = rule;
  return applies as T;
}

/** A version 3 document with every unreported `where` failing closed. */
export function cloudDocument(document: PolicyDocument): PolicyDocument {
  if (!hasContracts(document)) return document;
  return {
    ...document,
    rules: document.rules.flatMap((rule) => {
      const kept = failClosed(document, rule);
      return kept ? [kept] : [];
    }),
    gates: document.gates.map((gate) => failClosed(document, gate) ?? gate),
  };
}

/**
 * Only the projected shape's properties, read without trusting the sent
 * value's types: the validator then decides whether it conforms.
 */
function picked(properties: Record<string, ResolvedProperty>, sent: unknown) {
  if (typeof sent !== "object" || sent === null || Array.isArray(sent))
    return sent;
  const kept: Record<string, unknown> = {};
  for (const [name, property] of Object.entries(properties)) {
    if (!Object.hasOwn(sent, name)) continue;
    const value = (sent as Record<string, unknown>)[name];
    kept[name] =
      property.type === "object"
        ? picked(property.properties, value)
        : property.type === "list" &&
            property.of.type === "object" &&
            Array.isArray(value)
          ? value.map((item) =>
              picked(
                (property.of as { properties: typeof properties }).properties,
                item,
              ),
            )
          : value;
  }
  return kept;
}

/** The reported part of a sent value, if it conforms to the projection. */
function reportedValue(shape: ResolvedShape, sent: unknown, max: number) {
  if (sent === undefined) return undefined;
  const projected = projectShape(shape).shape;
  const checked = checkValue(
    projected,
    picked(projected.properties, sent),
    max,
  );
  return checked.state === "valid" ? checked.value : undefined;
}

const STARTERS = new Set(["claude-code", "codex"]);

/**
 * The values a call's `where` reads, from what the installation sent with
 * the action, so they are bound to its digest: `params.brief`, the started
 * agent's brief as its projection reports it, and `params.input`, the
 * operation's arguments, of which only reported fields are read. A value
 * that doesn't conform to the projection is no value: the call is decided
 * as one with nothing checked.
 */
export function contractValues(
  document: PolicyDocument,
  descriptor: Descriptor,
): Values | null {
  if (!hasContracts(document)) return null;
  const { params } = descriptor;
  const starts =
    STARTERS.has(descriptor.toolKey) &&
    descriptor.operationKey === "agent" &&
    descriptor.resourceKind === "agent";
  const brief = starts ? document.briefs?.[descriptor.resourceId] : undefined;
  if (brief) {
    const value = reportedValue(brief.shape, params.brief, PAYLOAD_BYTES.brief);
    return value ? { brief: value } : null;
  }
  const input = inputOf(document, descriptor.toolKey, descriptor.operationKey);
  if (!input) return null;
  const value = reportedValue(input.shape, params.input, PAYLOAD_BYTES.input);
  return value ? { input: value } : null;
}

const isHandback = (descriptor: Descriptor) =>
  descriptor.toolKey === HANDBACK_ACTION.tool &&
  descriptor.operationKey === HANDBACK_ACTION.operation;

/**
 * Why a step's receipt can't go back to its caller, or null when it can.
 * Only the run's step names the agent handing back: without it, a document
 * that declares receipts can't tell whether one is owed, so it is denied.
 */
function receiptRefusal(document: PolicyDocument, run: RunContext | null) {
  if (!hasContracts(document) || !Object.keys(document.receipts).length)
    return null;
  const step = run?.step;
  if (!step)
    return "This hand-back names no run step, so Cloud can't check the receipt its agent's contract may require, and it is denied: send it with its run and step.";
  if (!document.receipts[step.agent]) return null;
  const finished = run.events.findLast(
    (event) => event.type === "step.finished" && event.step === step.id,
  );
  const state =
    finished?.type === "step.finished" ? finished.receipt?.state : undefined;
  if (state === "valid") return null;
  return `${step.agent}'s receipt is ${state ?? "missing"}, so its hand-back is denied: hand back again ending with a receipt that follows its contract.`;
}

/**
 * A subagent's hand-back, as the local hook decides it: a step whose
 * agent has a declared receipt contract hands back only once Cloud has read
 * a valid receipt for it, and one without its step is denied when the
 * document declares receipts; otherwise a rule that covers the hand-back
 * decides, and when none does it goes ahead.
 */
export function decideHandback(
  result: SimulationResult,
  input: {
    document: PolicyDocument;
    descriptor: Descriptor;
    run: RunContext | null;
  },
): SimulationResult {
  if (!isHandback(input.descriptor)) return result;
  const refusal = receiptRefusal(input.document, input.run);
  if (refusal)
    return {
      ...result,
      outcome: "deny",
      matchedRuleId: null,
      explanation: refusal,
    };
  if (result.outcome !== "none") return result;
  return {
    ...result,
    outcome: "allow",
    explanation:
      "No rule covers this hand-back, and a subagent may hand its report back to its caller unless a rule says otherwise.",
  };
}
