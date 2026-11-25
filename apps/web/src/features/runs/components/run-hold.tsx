import Link from "next/link";
import { holdLabel } from "@/contracts/v1/glossary";
import type { RunHoldDto } from "@/contracts/v1/runs";
import { FormHint } from "@/components/app/note";
import { dividerHeading } from "@/components/app/styles";
import { HoldRequirements } from "./run-list";

const overrideHint = {
  gate: "Overriding it once lets this action through without these steps, and the record keeps who decided.",
  budget:
    "Allowing it over budget once lets this action through, and the record keeps who decided.",
} as const;

/** What a gate or budget is waiting for, as stored when it held the action. */
export function RunHold({
  hold,
  run,
}: {
  hold: RunHoldDto;
  run: { key: string; href: string } | null;
}) {
  return (
    <section
      aria-labelledby="run-hold-title"
      className="animate-in duration-200 fade-in-0 slide-in-from-bottom-1 [&_p]:mb-2 [&_p]:text-ui [&_p]:leading-normal [&_p]:[overflow-wrap:anywhere] [&_p]:text-body"
    >
      <h3 id="run-hold-title" className={dividerHeading}>
        {holdLabel(hold.kind, hold.name)}
      </h3>
      <p>
        {run ? (
          <>
            In run <Link href={run.href}>{run.key}</Link>.
          </>
        ) : (
          "No run was declared for this action."
        )}
      </p>
      {hold.kind === "gate" && hold.missing.length ? (
        <HoldRequirements hold={hold} />
      ) : (
        <p>{hold.explanation}</p>
      )}
      <FormHint>{overrideHint[hold.kind]}</FormHint>
    </section>
  );
}
