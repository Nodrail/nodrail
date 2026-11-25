"use client";

import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { focusRing } from "@/components/app/styles";
import { toneLooks } from "@/components/app/tones";
import { plural } from "@/lib/text";
import { cn } from "@/lib/utils";
import type { Problem } from "../yaml-lint";

/** What the count under the editor says, errors first. */
export function problemSummary(problems: Problem[]) {
  const errors = problems.filter((item) => item.severity === "error").length;
  const warnings = problems.length - errors;
  if (!problems.length) return "No problems";
  return [
    errors ? plural(errors, "error") : null,
    warnings ? plural(warnings, "warning") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The editor's problems as a list under it: each names its line and moves the
 * cursor there when chosen. The count is announced as it changes.
 */
export function PolicyProblems({
  id,
  problems,
  onSelect,
}: {
  id: string;
  problems: Problem[];
  onSelect: (problem: Problem) => void;
}) {
  return (
    <section id={id} aria-label="Problems" className="mt-3">
      <h3
        id={`${id}-summary`}
        className="flex items-center gap-1.5 text-ui font-semibold text-foreground"
        aria-live="polite"
      >
        {problems.length ? null : (
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
        )}
        Problems{" "}
        <span className="font-normal text-muted-foreground">
          · {problemSummary(problems)}
        </span>
      </h3>
      {problems.length ? (
        <ul className="stagger mt-1.5 grid gap-0.5">
          {problems.map((problem) => {
            const Icon =
              problem.severity === "error" ? CircleAlert : TriangleAlert;
            return (
              <li
                key={`${problem.from}:${problem.line}:${problem.column}:${problem.message}`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(problem)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-ui text-body [overflow-wrap:anywhere] hover:bg-muted",
                    focusRing,
                  )}
                >
                  <Icon
                    aria-label={problem.severity}
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      toneLooks[
                        problem.severity === "error" ? "danger" : "warning"
                      ].text,
                    )}
                  />
                  <code className="shrink-0 text-muted-foreground">
                    Line {problem.line}:{problem.column}
                  </code>
                  <span>
                    {problem.message}
                    {problem.from === "server" ? (
                      <span className="text-muted-foreground"> · review</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
