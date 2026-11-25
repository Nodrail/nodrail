import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A divided list inside a card: people, invites, decisions, runs. Rows come in
 * one after another (`stagger`) and are split by a quiet line.
 */
export function ItemList({ className, ...props }: ComponentProps<"ul">) {
  return (
    <ul
      className={cn("stagger divide-y divide-border/70", className)}
      {...props}
    />
  );
}

/** One row of an ItemList: its text on the left, status and actions right. */
export function ItemRow({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2.75 [overflow-wrap:anywhere]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A list row that is a card of its own (an agent in the list): its border,
 * and the padding of its main link. Skeletons draw the same box.
 */
export const boxedRow =
  "relative flex items-center rounded-lg border bg-card phone:flex-col phone:items-stretch";
export const boxedRowMain =
  "flex min-w-0 flex-1 items-center gap-3 px-3.5 py-3.25";
/** The trailing count after a boxed row's main link. */
export const boxedRowTrailing =
  "pr-4 pl-1 phone:pr-3.5 phone:pb-3 phone:pl-15.5";

/** The quiet line under an item's title. */
export const itemMeta = "mt-0.75 block text-xs text-muted-foreground";

/** An item's title in bold with a quiet line under it. */
export function ItemText({
  title,
  meta,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("min-w-0", className)}>
      <b className="block text-ui font-semibold text-foreground">{title}</b>
      {meta ? <small className={itemMeta}>{meta}</small> : null}
    </span>
  );
}

/**
 * A count beside a heading; it pops when it changes. A space comes first, so
 * the heading's name reads "Open requests 3".
 */
export function CountChip({
  count,
  className,
  ...props
}: ComponentProps<"span"> & { count: number }) {
  return (
    <>
      {" "}
      <span
        key={count}
        className={cn(
          "ml-0.5 inline-block animate-pop rounded-full bg-selected px-1.75 py-px text-xs",
          className,
        )}
        {...props}
      >
        {count}
      </span>
    </>
  );
}
