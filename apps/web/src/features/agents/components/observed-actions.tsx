import Link from "next/link";
import { focusRing } from "@/components/app/styles";
import type { ObservedActionDto, ObservedOutcome } from "@/contracts/v1/agents";
import { toneLooks, type Tone } from "@/components/app/tones";
import { plural } from "@/lib/text";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import { outcomeLabels } from "../presentation";

const outcomeTone: Record<ObservedOutcome, Tone> = {
  allowed_by_rule: "success",
  denied_by_rule: "danger",
  unknown_blocked: "warning",
  observed_only: "neutral",
};

/**
 * Each operation the agent asked for, on which resource, how often and how
 * it was last decided; the operation links to its events in Activity. One
 * column on phones.
 */
export function ObservedActions({
  actions,
  activityHref,
}: {
  actions: ObservedActionDto[];
  /** Activity for this agent, searched for one operation. */
  activityHref: (operation: string) => string;
}) {
  return (
    <ul data-slot="observed-actions" className="stagger mb-2.75">
      {actions.map((action) => {
        const operation = `${action.toolKey}.${action.operationKey}`;
        return (
          <li
            key={`${action.installationName}:${operation}:${action.resource}`}
            className="grid grid-cols-[minmax(150px,1.2fr)_minmax(140px,1fr)_minmax(150px,auto)] items-center gap-2.5 border-t border-muted py-2.5 text-ui phone:grid-cols-1 phone:gap-0.75"
          >
            <Link
              href={activityHref(operation)}
              className={cn(
                "rounded-sm font-mono text-xs [overflow-wrap:anywhere] text-body hover:underline",
                focusRing,
              )}
            >
              {operation}
            </Link>
            <span className="[overflow-wrap:anywhere] text-muted-foreground">
              {action.resource}
            </span>
            <span className="grid text-right phone:text-left">
              <span
                className={cn(
                  "text-xs font-semibold",
                  toneLooks[outcomeTone[action.outcome]].text,
                )}
              >
                {outcomeLabels[action.outcome]}
              </span>
              <span className="text-micro text-muted-foreground">
                {plural(action.attempts, "time")} · last{" "}
                <span suppressHydrationWarning>
                  {timeAgo(action.lastSeenAt)}
                </span>
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
