import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CountChip } from "./item-list";
import { sectionTitle } from "./styles";

/**
 * A section's title, with an optional count and a link to the full page
 * (a `TextLink size="xs"`).
 */
export function SectionHeading({
  title,
  count,
  countSlot = "section-count",
  action,
  as: Heading = "h2",
  className,
}: {
  title: string;
  count?: number;
  /** The count's `data-slot`, for tests that read it. */
  countSlot?: string;
  action?: ReactNode;
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div
      className={cn("mb-2 flex items-center justify-between gap-3", className)}
    >
      <Heading className={sectionTitle}>
        {title}
        {count ? <CountChip data-slot={countSlot} count={count} /> : null}
      </Heading>
      {action}
    </div>
  );
}
