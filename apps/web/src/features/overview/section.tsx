import type { ReactNode } from "react";
import { eyebrow, figure, focusRing } from "@/components/app/styles";
import { cn } from "@/lib/utils";

/** The small uppercase label over a tile's figure. */
export function TileLabel({ children }: { children: ReactNode }) {
  return <span className={eyebrow}>{children}</span>;
}

/** A tile's big number; it pops when it changes. */
export function Figure({
  value,
  className,
  children,
}: {
  value: string | number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      data-slot="tile-figure"
      className={cn("mt-1 block", figure, className)}
    >
      <span key={value} className="inline-block animate-pop">
        {value}
      </span>
      {children}
    </span>
  );
}

/** A tile's surface: a bordered card that is a link when it leads somewhere. */
export const tileClass =
  "flex min-w-0 flex-col rounded-xl border bg-card p-4 text-body transition-colors";

export const linkedTileClass = cn(
  tileClass,
  "hover:border-forest/40 hover:bg-muted/30",
  focusRing,
);
