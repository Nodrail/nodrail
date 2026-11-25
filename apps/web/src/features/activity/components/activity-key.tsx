import { COVERAGE } from "@/contracts/v1/glossary";
import { cn } from "@/lib/utils";

/** The key's box, shared with its skeleton. */
export const activityKeyBox =
  "mb-3.25 flex flex-wrap items-center gap-x-7 gap-y-2 rounded-lg border bg-card px-3 py-2.5 text-xs";

/** Says who records what: Nodrail records decisions, integrations send reports. */
export function ActivityKey() {
  return (
    <ul
      className={cn(
        activityKeyBox,
        "animate-in duration-200 fade-in-0 slide-in-from-bottom-1 [&_b]:block [&_small]:block [&_small]:text-muted-foreground",
      )}
    >
      <li>
        <b>Decision</b>
        <small>Recorded by Nodrail</small>
      </li>
      <li>
        <b>Client report</b>
        <small>Sent by your integration</small>
      </li>
      <li className="ml-auto text-muted-foreground phone:ml-0">{COVERAGE}</li>
    </ul>
  );
}
