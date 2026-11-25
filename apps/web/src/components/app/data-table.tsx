import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StackedTable } from "./stacked-table";
import { cn } from "@/lib/utils";
import { focusRing } from "./styles";

/** The bordered white box that holds a toolbar and a table. */
export function DataPanel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="data-panel"
      className={cn(
        "animate-in rounded-xl border bg-card duration-200 fade-in-0 slide-in-from-bottom-1",
        className,
      )}
      {...props}
    />
  );
}

/** Search and filters along the top of a DataPanel; `as="form"` for a search form. */
export function DataToolbar({
  as = "div",
  className,
  ...props
}: ComponentProps<"form"> & { as?: "div" | "form" }) {
  const Element = as as "form";
  return (
    <Element
      data-slot="data-toolbar"
      className={cn(
        "flex flex-wrap items-center gap-2 border-b px-3.25 py-2.75",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The product table: shadcn Table with uppercase headings, quiet row rules and
 * `<small>` second lines. Write plain `thead`/`th`/`td`; cells can still take
 * their own utilities (base styles use `:where`, so they never win). On phones
 * (`phone:`) rows stack as blocks and headings become screen-reader only: the
 * table keeps explicit ARIA roles, and each cell after the first shows its
 * column's name above it (StackedTable, `td[data-label]` in base.css). Mark a
 * cell `data-blank` to drop it there. Select rows by
 * `[data-slot=data-table] tbody tr`.
 */
export function DataTable({ className, ...props }: ComponentProps<"table">) {
  return (
    <StackedTable
      data-slot="data-table"
      className={cn(
        "border-collapse text-ui",
        "[:where(&)_th]:border-b [:where(&)_th]:px-3.25 [:where(&)_th]:py-2.5 [:where(&)_th]:text-left [:where(&)_th]:text-micro [:where(&)_th]:font-semibold [:where(&)_th]:tracking-label [:where(&)_th]:text-muted-foreground [:where(&)_th]:uppercase",
        "[:where(&)_td]:border-b [:where(&)_td]:border-border/70 [:where(&)_td]:px-3.25 [:where(&)_td]:py-2.75 [:where(&)_td]:align-middle [:where(&)_td]:[overflow-wrap:anywhere] [:where(&)_td]:text-body [:where(&)_tr:last-child_td]:border-b-0",
        "[:where(&)_tbody_tr]:transition-colors [:where(&)_tbody_tr]:hover:bg-muted/50",
        "[:where(&)_small]:mt-0.75 [:where(&)_small]:block [:where(&)_small]:text-xs [:where(&)_small]:text-muted-foreground",
        "phone:block phone:[:where(&)_tbody]:block phone:[:where(&)_thead]:sr-only",
        "phone:[:where(&)_tr]:block phone:[:where(&)_tr]:border-b phone:[:where(&)_tr]:border-border/70 phone:[:where(&)_tr]:px-3.25 phone:[:where(&)_tr]:py-2.75 phone:[:where(&)_tr:last-child]:border-b-0",
        "phone:[:where(&)_td]:block phone:[:where(&)_td]:border-0 phone:[:where(&)_td]:px-0 phone:[:where(&)_td]:py-0.75 phone:[:where(&)_td[data-blank]]:hidden",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The row's name, as a link. The one rule for every list: the name opens the
 * entry's own page (a rule, an agent, a run); an entry with no page of its own
 * (a gate, a budget) opens its form, for people who can change it, and is a
 * plain DataTitle for everyone else.
 */
export function DataTitleLink({
  className,
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="data-title"
      className={cn(
        "rounded-sm font-semibold text-foreground hover:underline",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

/** The row's name when it has no page of its own. */
export function DataTitle({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="data-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  );
}

/** The heading over DataActionsCell, named for screen readers only. */
export function DataActionsHeading({ label = "Actions" }: { label?: string }) {
  return (
    <th scope="col">
      <span className="sr-only">{label}</span>
    </th>
  );
}

/** The last cell, holding row buttons; right-aligned, left-aligned on phones. */
export function DataActionsCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      className={cn(
        "text-right whitespace-nowrap *:ml-1 phone:pt-2 phone:text-left phone:whitespace-normal phone:*:mr-1 phone:*:ml-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * When a search or filter matches nothing in a list that has rows: says so,
 * and how to see them all again.
 */
export function NoMatches({
  noun,
  children = "Try a different search or filter.",
}: {
  /** What the list holds, plural: "rules", "gates". */
  noun: string;
  children?: ReactNode;
}) {
  return (
    <DataEmpty role="status" data-slot="no-match">
      <b>No matching {noun}</b>
      {children}
    </DataEmpty>
  );
}

/** A table's empty or no-match message; a bold first line names the case. */
export function DataEmpty({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="data-empty"
      className={cn(
        "animate-in px-4 py-7.5 text-center text-ui text-muted-foreground duration-200 fade-in-0 [&_b]:mb-0.75 [&_b]:block [&_b]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A one-line count above a list, such as "3 policies". */
export function ListSummary({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="list-summary"
      className={cn("mb-3.25 text-ui text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Under a paged list: back to the newest page once past it, and on to the
 * next while there is one. Renders nothing on a list of one page.
 */
export function ListPager({
  newest,
  next,
  nextLabel,
}: {
  /** The first page, when this is not it. */
  newest: string | null;
  next: string | null;
  nextLabel: string;
}) {
  if (!newest && !next) return null;
  return (
    <p data-slot="list-pager" className="mt-3 flex flex-wrap gap-2">
      {newest ? (
        <Button asChild variant="ghost">
          <Link href={newest}>Newest</Link>
        </Button>
      ) : null}
      {next ? (
        <Button asChild variant="outline">
          <Link href={next}>{nextLabel}</Link>
        </Button>
      ) : null}
    </p>
  );
}
