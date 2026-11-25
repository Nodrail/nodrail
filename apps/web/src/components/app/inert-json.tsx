import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/**
 * Preformatted text in a scrollable, focusable box: payloads, snippets.
 * Select it by `[data-slot=inert-json]`.
 */
export function CodeBlock({ className, ...props }: ComponentProps<"pre">) {
  return (
    <pre
      tabIndex={0}
      data-slot="inert-json"
      className={cn(
        "max-h-55 overflow-auto rounded-md bg-muted p-2.5 text-xs [overflow-wrap:anywhere] whitespace-pre-wrap",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

/** Data from an agent or integration, shown exactly as it arrived. */
export function InertJson({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <CodeBlock className={className}>
      {JSON.stringify(value, null, 2)}
    </CodeBlock>
  );
}
