import type {
  ContractCheckDto,
  ObservedValue,
} from "@/contracts/v1/contract-explain";
import { IssueList } from "./receipt-inspector";

/**
 * Why a gate's receipt requirement holds, at path level: each condition
 * with what it expects and what the receipt has (a redacted marker when
 * the contract doesn't report it), then one next step.
 */

const observed = (value: ObservedValue) =>
  value.kind === "value"
    ? value.value
    : value.kind === "redacted"
      ? "redacted"
      : "not provided";

export function ContractCheck({ check }: { check: ContractCheckDto }) {
  return (
    <div
      data-slot="contract-check"
      data-reason={check.reason}
      className="grid gap-1 pl-4 text-xs text-muted-foreground"
    >
      <p>{check.summary}</p>
      {check.conditions.length ? (
        <ul className="grid gap-0.5">
          {check.conditions.map((condition) => (
            <li key={condition.path} data-met={condition.met}>
              <code>{condition.path}</code> {condition.expected}
              {" · has "}
              <span
                className={
                  condition.observed.kind === "value" ? undefined : "italic"
                }
              >
                {observed(condition.observed)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {check.issues.length ? (
        <IssueList issues={check.issues} count={check.issues.length} />
      ) : null}
      {check.nextStep ? (
        <p>
          <strong className="font-semibold text-body">Next:</strong>{" "}
          {check.nextStep}
        </p>
      ) : null}
    </div>
  );
}
