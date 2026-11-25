import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CardActions, Panel } from "./card";
import { factLabel, factList } from "./card";

/*
 * Loading placeholders shaped like the shared product components, so a
 * route's loading.tsx can compose them and nothing jumps when content lands.
 * Every piece is aria-hidden; LoadingPage carries the spoken status.
 */

const buttonWidths = ["w-28", "w-36", "w-24"];
const widths = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5", "w-3/5"];

/** A width class that varies with the index, so rows of bars look like text. */
export function lineWidth(index: number) {
  return widths[index % widths.length];
}

/** Keys 0 to n - 1, for rendering n placeholders. */
export function skeletonKeys(count: number) {
  return Array.from({ length: count }, (_, index) => index);
}

/**
 * One line of text as a bar. It takes the line box of the text size it is
 * given (`text-ui` by default; `text-xs`, `text-title` and so on), so its
 * height matches the line it stands for. Set the width with a `w-*` class.
 */
export function LineSkeleton({ className }: { className?: string }) {
  return (
    <span
      data-slot="line-skeleton"
      className={cn(
        "flex h-lh w-full max-w-full items-center text-ui",
        className,
      )}
    >
      <Skeleton className="h-[0.75em] w-full rounded-sm" />
    </span>
  );
}

/** A few lines of body text, the last one shorter. */
export function TextSkeleton({
  lines = 2,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div data-slot="text-skeleton" className={cn("grid", className)}>
      {skeletonKeys(lines).map((index) => (
        <LineSkeleton
          key={index}
          className={index === lines - 1 && lines > 1 ? "w-3/5" : "w-full"}
        />
      ))}
    </div>
  );
}

const buttonSizes = {
  default: "h-9",
  sm: "h-8 w-14",
  lg: "h-10 w-36",
  icon: "size-9",
};

/** A Button-sized block; `size` follows Button's sizes. */
export function ButtonSkeleton({
  size = "default",
  className,
}: {
  size?: keyof typeof buttonSizes;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("w-28 shrink-0 rounded-md", buttonSizes[size], className)}
    />
  );
}

/** A StatusBadge-sized pill. */
export function BadgeSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-5.5 w-16 shrink-0 rounded-full", className)} />
  );
}

/** An AgentAvatar-sized square. */
export function AvatarSkeleton() {
  return <Skeleton className="size-9 shrink-0 rounded-md" />;
}

/**
 * Wraps a route's placeholders: marked busy, with a screen-reader status
 * "Loading <label>…". The placeholders inside are aria-hidden.
 */
export function LoadingPage({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-slot="loading-page" aria-busy="true">
      <p role="status" className="sr-only">
        Loading {label}…
      </p>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** PageHeader's shape: title and purpose, with optional back, lead, status and actions. */
export function PageHeaderSkeleton({
  back = false,
  lead = false,
  status = false,
  actions = 0,
}: {
  back?: boolean;
  lead?: boolean;
  status?: boolean;
  actions?: number;
}) {
  return (
    <div
      data-slot="page-header-skeleton"
      aria-hidden="true"
      className="mb-5 flex items-center justify-between gap-5 phone:flex-wrap phone:items-start"
    >
      {back ? <ButtonSkeleton size="icon" /> : null}
      {lead ? <AvatarSkeleton /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <LineSkeleton className="mb-0.5 w-48 text-display leading-[1.2]" />
          {status ? <BadgeSkeleton /> : null}
        </div>
        <LineSkeleton className="w-96 text-sm" />
      </div>
      {actions ? (
        <div className="flex flex-col items-end gap-1.5 phone:w-full phone:items-start">
          <div className="flex flex-wrap gap-2">
            {skeletonKeys(actions).map((index) => (
              <ButtonSkeleton
                key={index}
                className={index === actions - 1 ? "w-32" : "w-24"}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** CardHeading's shape: a title line, an optional description and action. */
export function CardHeadingSkeleton({
  description = false,
  action,
}: {
  description?: boolean;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3.5 flex items-start justify-between gap-3 phone:flex-wrap">
      <div className="min-w-0 flex-1">
        <LineSkeleton className="mb-1 w-36 text-title leading-[1.3]" />
        {description ? <LineSkeleton className="w-72 text-xs" /> : null}
      </div>
      {action}
    </div>
  );
}

/** Panel with its padding, radius and border, holding `children` or `lines` of text. */
export function PanelSkeleton({
  lines = 3,
  className,
  children,
}: {
  lines?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Panel data-slot="panel-skeleton" aria-hidden="true" className={className}>
      {children ?? <TextSkeleton lines={lines} />}
    </Panel>
  );
}

/** Card's shape: a Panel with a heading, then `children` or `lines` of text. */
export function CardSkeleton({
  description = false,
  action,
  lines = 3,
  className,
  children,
}: {
  description?: boolean;
  action?: ReactNode;
  lines?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <PanelSkeleton className={className}>
      <CardHeadingSkeleton description={description} action={action} />
      {children ?? <TextSkeleton lines={lines} />}
    </PanelSkeleton>
  );
}

/** CardActions' shape: a row of `buttons` buttons under a card's content. */
export function CardActionsSkeleton({ buttons = 1 }: { buttons?: number }) {
  return (
    <CardActions aria-hidden="true">
      {skeletonKeys(buttons).map((index) => (
        <ButtonSkeleton
          key={index}
          className={buttonWidths[index % buttonWidths.length]}
        />
      ))}
    </CardActions>
  );
}

/** Note's tinted box (info or warning) with `lines` lines of small text. */
export function NoteSkeleton({ lines = 1 }: { lines?: number }) {
  return (
    <div
      aria-hidden="true"
      className="mt-3.5 grid rounded-md bg-muted px-3 py-2.5"
    >
      {skeletonKeys(lines).map((index) => (
        <LineSkeleton
          key={index}
          className={cn("text-xs leading-normal", lineWidth(index + 3))}
        />
      ))}
    </div>
  );
}

/** Disclosure's shape, closed: the rule and its summary line. */
export function DisclosureSkeleton() {
  return (
    <div aria-hidden="true" className="mt-3.5 border-t pt-2.75">
      <LineSkeleton className="w-52 text-xs" />
    </div>
  );
}

/** FactList's shape: label and value pairs, two columns where there is room. */
export function FactListSkeleton({ rows }: { rows: number }) {
  return (
    <div data-slot="fact-list-skeleton" aria-hidden="true" className={factList}>
      {skeletonKeys(rows).map((index) => (
        <div key={index}>
          <LineSkeleton className={cn(factLabel, "w-24")} />
          <LineSkeleton className={lineWidth(index)} />
        </div>
      ))}
    </div>
  );
}

/** FormField's shape: label, input and an optional hint. */
export function FormFieldSkeleton({ hint = false }: { hint?: boolean }) {
  return (
    <div
      data-slot="form-field-skeleton"
      aria-hidden="true"
      className="grid gap-1.5"
    >
      <LineSkeleton className="w-28 leading-normal" />
      <Skeleton className="h-9 w-full rounded-md" />
      {hint ? <LineSkeleton className="w-3/4 text-xs leading-normal" /> : null}
    </div>
  );
}
