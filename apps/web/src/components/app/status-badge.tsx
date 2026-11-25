import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toneLooks, type Tone } from "./tones";

/** A status in words with a tone dot; select it by `[data-slot=status-badge]`. */
export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  return (
    <Badge
      data-slot="status-badge"
      data-tone={tone}
      variant="ghost"
      className={cn(
        "gap-1.25 px-2 py-0.75 text-micro font-semibold",
        toneLooks[tone].soft,
      )}
    >
      <i aria-hidden="true" className="size-1.25 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
