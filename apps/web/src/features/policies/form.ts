import type { Condition, RuleDto } from "@/contracts/v1/policies";
import type { RuleDraft } from "./summary";

type Scalar = string | number | boolean;

function parseScalar(text: string): Scalar {
  const value = text.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export function parseConditionValue(
  op: Condition["op"],
  text: string,
): Condition["value"] {
  if (op !== "in") return parseScalar(text);
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseScalar);
}

export function formatConditionValue(value: Condition["value"]) {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

const text = (data: FormData, name: string) => {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** A list the form keeps as JSON in a hidden field, or null if it isn't JSON. */
function parseConditions(raw: string): unknown {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return null;
  }
}

/** The operation and resource fields, shared by rules and gates. */
function targetFromForm(data: FormData) {
  const operation = text(data, "operation");
  const dot = operation.indexOf(".");
  const match = text(data, "resourceMatch");
  return {
    toolKey: dot > 0 ? operation.slice(0, dot) : operation,
    operationKey: dot > 0 ? operation.slice(dot + 1) : "",
    resource: {
      kind: text(data, "resourceKind"),
      match,
      ...(match === "any" ? {} : { value: text(data, "resourceValue") }),
    },
  };
}

/** The form's fields as a rule. The server validates the result. */
export function ruleFromForm(data: FormData): RuleDraft {
  const expires = text(data, "expiresOn");
  return {
    name: text(data, "name"),
    effect: text(data, "effect"),
    agentKey: text(data, "agentKey") || null,
    installationName: text(data, "installationName") || null,
    ...targetFromForm(data),
    conditions: parseConditions(text(data, "conditions")),
    expiresAt: expires ? `${expires}T23:59:59Z` : null,
  };
}

/** "pass, approved" → ["pass", "approved"]. */
export const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** The gate form's fields as a gate. The server validates the result. */
export function gateFromForm(data: FormData): unknown {
  return {
    name: text(data, "name"),
    // Unmet, a gate denies with its reason; nothing waits for a person.
    effect: "deny",
    agentKey: text(data, "agentKey") || null,
    ...targetFromForm(data),
    requires: parseConditions(text(data, "requires")),
  };
}

const numberOrNull = (value: string) =>
  value === "" ? null : Number(value.replace(/[,_\s]/g, ""));

/** The budget form's fields as a budget. The server validates the result. */
export function budgetFromForm(data: FormData): unknown {
  const per = text(data, "per");
  return {
    name: text(data, "name"),
    effect: "deny",
    per,
    agent: per === "step" ? text(data, "agent") || null : null,
    metric: text(data, "metric"),
    limit: numberOrNull(text(data, "limit")),
    warnAt: numberOrNull(text(data, "warnAt")),
  };
}

/**
 * Another active rule for the same operation and agent. A hint only: it does
 * not confirm that both rules match the same calls.
 */
export function findOverlap(
  rules: RuleDto[],
  draft: { operation: string; agentKey: string; excludeId?: string },
) {
  const operation = draft.operation.trim().toLowerCase();
  if (!operation) return undefined;
  return rules.find(
    (rule) =>
      rule.status === "active" &&
      rule.logicalRuleId !== draft.excludeId &&
      `${rule.toolKey}.${rule.operationKey}` === operation &&
      (!rule.agentKey || !draft.agentKey || rule.agentKey === draft.agentKey),
  );
}
