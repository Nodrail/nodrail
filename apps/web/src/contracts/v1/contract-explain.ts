import type { ContractEventDto, SafeValidationIssue } from "./contract-events";
import {
  matchWhere,
  satisfiesAuthority,
  valueAt,
  type CompiledCondition,
  type ProducerClass,
} from "./shapes-engine";

/**
 * A gate result for a declared receipt gives the exact path, the expected condition,
 * the observed value only when the projection reports it (a redacted marker
 * otherwise), authority and freshness mismatches, and one next step. A
 * contract revision mismatch never says "rerun": rerunning under the old
 * instructions can't fix it. Reads only projected values, so the same
 * explanation is safe in the UI, exports and notifications.
 */

/** A gate's requirement on one agent's receipt, as compiled (C01). */
export type ContractRequirement = {
  agent: string;
  /** Acceptable verdicts; null when the requirement doesn't name any. */
  verdicts: string[] | null;
  where: CompiledCondition[];
  /** The least producer authority the gate accepts. */
  authority: Exclude<ProducerClass, "person-authenticated">;
  /** The contract digest the gate's binding pins now, if it pins one. */
  contractDigest: string | null;
  /** The revision the action is about, for `subject: revision`. */
  subjectRevision: string | null;
};

export type ObservedValue =
  | { kind: "value"; value: string }
  | { kind: "redacted" }
  | { kind: "not_provided" };

export type ConditionCheckDto = {
  path: string;
  expected: string;
  observed: ObservedValue;
  met: boolean;
};

export const contractCheckReasons = [
  "met",
  "no_receipt",
  "missing",
  "unsupported",
  "contract_changed",
  "invalid",
  "reported_only",
  "authority",
  "stale_subject",
  "verdict",
  "condition",
  /** The receipt meets it, but the work changed after that step began. */
  "work_changed",
  /** The receipt meets it, but nothing says which revision it was about. */
  "subject_unknown",
] as const;
export type ContractCheckReason = (typeof contractCheckReasons)[number];

export type ContractCheckDto = {
  met: boolean;
  reason: ContractCheckReason;
  /** What the explanation is about, in one line. */
  summary: string;
  conditions: ConditionCheckDto[];
  issues: SafeValidationIssue[];
  /** One step that can change the outcome; null when met. */
  nextStep: string | null;
};

const short = (digest: string) => digest.replace(/^sha256:/, "").slice(0, 12);

const words: Record<ProducerClass, string> = {
  "agent-reported": "agent-reported",
  "runtime-observed": "runtime-observed",
  "externally-verified": "externally verified",
  "person-authenticated": "person-authenticated",
};

export function expectedText(condition: CompiledCondition) {
  if (condition.op === "eq") return `= ${String(condition.value)}`;
  if (condition.op === "in") return `one of ${condition.values.join(", ")}`;
  if (condition.min !== null && condition.max !== null)
    return `between ${condition.min} and ${condition.max}`;
  return condition.min !== null
    ? `at least ${condition.min}`
    : `at most ${String(condition.max)}`;
}

/** What the receipt shows at a path, as Cloud may show it. */
function observedAt(event: ContractEventDto, path: string[]): ObservedValue {
  const dotted = path.join(".");
  if (
    event.redacted.some(
      (withheld) => dotted === withheld || dotted.startsWith(`${withheld}.`),
    )
  )
    return { kind: "redacted" };
  const found = valueAt(event.fields, path);
  if (
    typeof found === "string" ||
    typeof found === "number" ||
    typeof found === "boolean"
  )
    return { kind: "value", value: String(found) };
  return { kind: "not_provided" };
}

const observedText = (observed: ObservedValue) =>
  observed.kind === "value"
    ? observed.value
    : observed.kind === "redacted"
      ? "a redacted value"
      : "no value";

function check(
  reason: ContractCheckReason,
  summary: string,
  nextStep: string | null,
  extra: Partial<Pick<ContractCheckDto, "conditions" | "issues">> = {},
): ContractCheckDto {
  return {
    met: reason === "met",
    reason,
    summary,
    conditions: extra.conditions ?? [],
    issues: extra.issues ?? [],
    nextStep,
  };
}

/** Before any value is read: was there a usable receipt at all? */
function unusable(
  requirement: ContractRequirement,
  event: ContractEventDto | null,
): ContractCheckDto | null {
  const { agent } = requirement;
  const rerun = `Rerun ${agent} so its step ends with a receipt.`;
  if (!event)
    return check("no_receipt", `${agent} hasn't sent a receipt`, rerun);
  if (event.capture === "missing")
    return check(
      "missing",
      `${agent}'s step finished without a receipt`,
      rerun,
    );
  if (event.capture === "unsupported")
    return check(
      "unsupported",
      `This host can't capture ${agent}'s final output`,
      `Use a host or connector that captures ${agent}'s receipt; rerunning won't change this.`,
    );
  if (
    requirement.contractDigest !== null &&
    event.contract.digest !== requirement.contractDigest
  )
    return check(
      "contract_changed",
      `The receipt was checked against contract ${short(event.contract.digest)}; the gate now pins ${short(requirement.contractDigest)}`,
      `Apply the current workspace revision so ${agent}'s instructions match the contract; its next receipt is checked against it.`,
    );
  if (event.validation !== "valid")
    return check(
      "invalid",
      `${agent}'s receipt doesn't match its contract`,
      `Fix the receipt at the paths below, then rerun ${agent}.`,
      { issues: event.issues },
    );
  return null;
}

/** Who produced it and what it is about. */
function untrusted(
  requirement: ContractRequirement,
  event: ContractEventDto,
): ContractCheckDto | null {
  const { agent } = requirement;
  if (!event.authorizes)
    return check(
      "reported_only",
      `Local report: it can't satisfy a Cloud gate`,
      `Run ${agent} where the Cloud runtime submits its receipt; a reported copy never authorizes.`,
    );
  const have = event.provenance.producerClass;
  if (!satisfiesAuthority(have, requirement.authority))
    return check(
      "authority",
      `A ${words[have]} receipt can't stand in for ${words[requirement.authority]} evidence`,
      `Add evidence from a ${words[requirement.authority]} producer; rerunning ${agent} won't change who produced it.`,
    );
  const subject = event.provenance.subject?.revision ?? null;
  if (
    requirement.subjectRevision !== null &&
    subject !== requirement.subjectRevision
  )
    return check(
      "stale_subject",
      subject
        ? `The receipt is for an older revision (${short(subject)})`
        : "The receipt names no revision",
      `Rerun ${agent} on the current revision.`,
    );
  return null;
}

export function explainRequirement(
  requirement: ContractRequirement,
  event: ContractEventDto | null,
): ContractCheckDto {
  const early = unusable(requirement, event) ?? untrusted(requirement, event!);
  if (early) return early;
  const valid = event!;
  const { agent, verdicts } = requirement;
  if (verdicts && (!valid.verdict || !verdicts.includes(valid.verdict)))
    return check(
      "verdict",
      valid.verdict
        ? `${agent} reported ${valid.verdict}; this needs ${verdicts.join(" or ")}`
        : `${agent}'s verdict isn't reported; this needs ${verdicts.join(" or ")}`,
      `Address what ${agent} found and rerun it.`,
    );
  const conditions = requirement.where.map((condition) => ({
    path: condition.path.join("."),
    expected: expectedText(condition),
    observed: observedAt(valid, condition.path),
    met: matchWhere([condition], valid.fields),
  }));
  const unmet = conditions.find((condition) => !condition.met);
  if (unmet)
    return check(
      "condition",
      `Needs ${unmet.path} ${unmet.expected}; the receipt has ${observedText(unmet.observed)}`,
      // Cloud can't check a withheld value it was never sent; one it read
      // on the runtime path, and only withholds from view, it did check.
      unmet.observed.kind === "redacted" &&
        valueAt(valid.fields, unmet.path.split(".")) === undefined
        ? `${unmet.path} isn't reported, so Cloud can't check it: report it in the contract, or drop the condition.`
        : `Address it and rerun ${agent}.`,
      { conditions },
    );
  return check("met", `${agent}'s receipt meets the requirement`, null, {
    conditions,
  });
}

/**
 * When the receipt itself meets the requirement but the run doesn't: the
 * work changed after the step that sent it began, or the requirement needs
 * the revision it was about and the runtime didn't say. Rerunning helps.
 */
export function explainRunShortfall(
  requirement: Pick<ContractRequirement, "agent">,
  met: ContractCheckDto,
  subjectUnknown: boolean,
): ContractCheckDto {
  const { agent } = requirement;
  const extra = { conditions: met.conditions };
  return subjectUnknown
    ? check(
        "subject_unknown",
        `${agent}'s receipt doesn't say which revision it reviewed`,
        `Rerun ${agent} where the runtime records the revision it reviewed.`,
        extra,
      )
    : check(
        "work_changed",
        `The work changed after ${agent}'s last step began`,
        `Rerun ${agent} on the current work.`,
        extra,
      );
}
