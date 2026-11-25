import type { ComponentProps, ReactNode } from "react";
import type { Requirement } from "@nodrail/policy-engine";
import {
  holdSummary,
  requirementLabel,
  requirementState,
  requirementStatusText,
  type RequirementState,
  type RequirementStatusDto,
  type RunHoldDto,
} from "@/contracts/v1/runs";
import { ContractCheck } from "@/features/contracts/components/contract-check";
import { formatUtc } from "@/lib/time";
import { cn } from "@/lib/utils";

/** A ruled list of run entries, gates or budgets; items rise in turn. */
export function RunList({
  as: Element = "ol",
  className,
  ...props
}: ComponentProps<"ol"> & { as?: "ol" | "ul" }) {
  return <Element className={cn("stagger grid", className)} {...props} />;
}

/**
 * One entry in a RunList, separated by a hairline; times and `<small>` notes
 * are quiet. Select by `[data-slot=run-entry]`.
 */
export function RunEntry({
  indent = false,
  className,
  ...props
}: ComponentProps<"li"> & { indent?: boolean }) {
  return (
    <li
      data-slot="run-entry"
      className={cn(
        "grid gap-1 border-t border-border py-3 text-ui [overflow-wrap:anywhere] first:border-t-0",
        "[&_small]:text-xs [&_small]:text-muted-foreground [&_time]:text-xs [&_time]:text-muted-foreground",
        indent && "border-l-2 border-l-border pl-3",
        className,
      )}
      {...props}
    />
  );
}

/** The entry's first line: who, what, and any badge, wrapping as needed. */
export function RunEntryTitle({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-1.5 text-body">
      {children}
    </p>
  );
}

/** The steps a gate requires or a hold is missing, one bullet each. */
export function RequirementList({
  requirements,
}: {
  requirements: Requirement[];
}) {
  return (
    <ul className="mt-1.5 mb-2 list-disc pl-4.5 text-ui leading-[1.6] text-body">
      {requirements.map((requirement) => (
        <li key={requirement.agent}>{requirementLabel(requirement)}</li>
      ))}
    </ul>
  );
}

const marks: Record<RequirementState, { mark: string; className: string }> = {
  met: { mark: "✓", className: "text-success" },
  unmet: { mark: "✗", className: "text-destructive" },
  silent: { mark: "○", className: "text-muted-foreground" },
};

/** One requirement as the run stood: "✗ qa reported fail (needs pass) · 18:52". */
function RequirementStatus({ status }: { status: RequirementStatusDto }) {
  const state = requirementState(status);
  const { mark, className } = marks[state];
  return (
    <li data-slot="requirement-status" data-state={state}>
      <span aria-hidden="true" className={cn("inline-block w-4", className)}>
        {mark}
      </span>
      <span className="sr-only">{state === "met" ? "Met: " : "Not met: "}</span>
      {requirementStatusText(status)}
      {status.reported ? (
        <small className="text-muted-foreground">
          {" · "}
          <time dateTime={status.reported.at}>
            {formatUtc(status.reported.at)}
          </time>
        </small>
      ) : null}
      <small className="block pl-4 text-xs text-muted-foreground">
        {requirementLabel(status)}
      </small>
      {status.check && !status.met ? (
        <ContractCheck check={status.check} />
      ) : null}
    </li>
  );
}

/**
 * Why a gate holds an action: "Held: 1 of 2 requirements unmet", then each
 * requirement with its status. A hold recorded before statuses were kept
 * lists only the requirements it was missing.
 */
export function HoldRequirements({
  hold,
}: {
  hold: Pick<RunHoldDto, "missing" | "requirements">;
}) {
  return (
    <div data-slot="hold-requirements" className="mt-1.5 mb-2">
      <p className="text-ui font-semibold text-warning-strong">
        {holdSummary(hold)}
      </p>
      {hold.requirements ? (
        <ul className="mt-1 grid gap-1 text-ui leading-normal text-body">
          {hold.requirements.map((status, index) => (
            <RequirementStatus
              key={`${status.agent}-${index}`}
              status={status}
            />
          ))}
        </ul>
      ) : (
        <RequirementList requirements={hold.missing} />
      )}
    </div>
  );
}

/** A number that pops when it changes, such as a count in a fact list. */
export function Count({ value }: { value: number }) {
  return (
    <span key={value} className="inline-block animate-pop">
      {value}
    </span>
  );
}
