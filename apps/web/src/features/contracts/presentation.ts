import type { Tone } from "@/components/app/tones";
import type {
  ContractEventDto,
  ExecutionOutcome,
  IssueCode,
  ProducerClass,
} from "@/contracts/v1/contract-events";
import type { SchemaAvailability } from "@/contracts/v1/declared-contracts";

/**
 * How a declared-contract event reads on a page. Invalid, missing, unsupported and redacted stay four
 * different things, and a verdict is what the agent said, never proof.
 */

type State = { tone: Tone; label: string };

/** What each surface's event is called on a page. */
export const surfaceNouns: Record<ContractEventDto["surface"], string> = {
  receipt: "Receipt",
  brief: "Brief",
  tool_input: "Input",
  tool_result: "Result",
  evidence: "Evidence",
  memory_record: "Memory record",
  file: "File",
  inventory_metadata: "Labels",
};

/** A receipt's one state: what the badge says. */
function receiptState(event: ContractEventDto): State {
  if (event.capture === "missing")
    return { tone: "warning", label: "Finished without a receipt" };
  if (event.capture === "unsupported")
    return { tone: "neutral", label: "Host can't capture this receipt" };
  if (event.validation === "invalid")
    return { tone: "danger", label: "Invalid receipt" };
  return {
    tone: "success",
    label: event.verdict ? `Valid · ${event.verdict}` : "Valid receipt",
  };
}

/**
 * A connection result's state (S04): what the provider did stays apart
 * from whether the result conformed, and an invalid result never reads as
 * undone.
 */
function resultState(event: ContractEventDto): State {
  if (event.execution === "not-called")
    return { tone: "neutral", label: "Provider not called" };
  if (event.capture === "unsupported")
    return { tone: "neutral", label: "Result not intercepted" };
  if (event.capture === "missing")
    return { tone: "warning", label: "No result captured" };
  if (event.validation === "invalid")
    return event.execution === "succeeded"
      ? { tone: "danger", label: "Provider ran; result unusable" }
      : { tone: "danger", label: "Invalid result" };
  return {
    tone: "success",
    label:
      event.delivered === false
        ? "Valid result · not delivered"
        : "Valid result",
  };
}

/** A brief's or input's state (S02, S03): invalid means stopped before it ran. */
function beforeState(event: ContractEventDto, noun: string): State {
  const blocked =
    event.surface === "brief" ? "dispatch blocked" : "provider not called";
  if (event.capture === "missing")
    return {
      tone: "warning",
      label: `${noun} not observed · ${blocked}`,
    };
  if (event.capture === "unsupported")
    return {
      tone: "neutral",
      label: `Host can't capture this ${noun.toLowerCase()}`,
    };
  if (event.validation === "invalid")
    return {
      tone: "danger",
      label: `Invalid ${noun.toLowerCase()} · ${blocked}`,
    };
  return { tone: "success", label: `Valid ${noun.toLowerCase()}` };
}

/** The event's one state: what the badge says. */
export function eventState(event: ContractEventDto): State {
  if (event.surface === "tool_result") return resultState(event);
  if (event.surface === "brief" || event.surface === "tool_input")
    return beforeState(event, surfaceNouns[event.surface]);
  return receiptState(event);
}

/** A run event's reported receipt state, when no checked event came with it. */
export const reportedReceiptLabels = {
  valid: "Valid receipt",
  invalid: "Invalid receipt",
  missing: "Finished without a receipt",
} as const;

/** What the provider did, as a result records it; never "undone". */
export const executionLabels: Record<ExecutionOutcome, string> = {
  succeeded: "Ran and succeeded",
  failed: "Ran and failed",
  "not-called": "Not called",
  unknown: "Outcome unknown",
};

export const producerLabels: Record<ProducerClass, string> = {
  "agent-reported": "Agent-reported",
  "runtime-observed": "Runtime-observed",
  "externally-verified": "Externally verified",
  "person-authenticated": "Person-authenticated",
};

export const availabilityLabels: Record<SchemaAvailability, string> = {
  pinned: "full contract pinned in Cloud",
  projection_only:
    "only the reported part is here; the full contract stayed local",
  unavailable: "contract unavailable: no longer stored",
};

/** Why a path failed, in words; never the value that failed. */
export const issueLabels: Record<IssueCode, string> = {
  required: "required, not given",
  unknown: "not declared",
  type: "wrong type",
  enum: "not an allowed value",
  "too-short": "too short",
  "too-long": "too long",
  "too-few": "too few items",
  "too-many": "too many items",
  below: "below the minimum",
  above: "above the maximum",
  duplicate: "repeats an item",
  parse: "couldn't be read",
  "not-final": "not the last block of the message",
  identity: "names another agent",
  size: "over the size limit",
  other: "doesn't match",
};

/** Who checked the full receipt, and what that means for trust. */
export function validatedByText(event: ContractEventDto) {
  if (event.validatedBy === "server") return "Checked by Cloud";
  if (event.validatedBy === "producer")
    return "Checked on the machine; Cloud checked only what was reported";
  return "Not checked: nothing was captured";
}

export const shortDigest = (digest: string) =>
  digest.replace(/^sha256:/, "").slice(0, 12);

/** A reported value as text: strings as they are, the rest as JSON. */
export const valueText = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value);
