import type { ComponentProps, ReactNode } from "react";
import { Card as UiCard, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardTitle, dialogTitle, focusRing } from "./styles";

/** The product's white panel: shadcn Card with the product's padding and radius. */
export function Panel({ className, ...props }: ComponentProps<typeof UiCard>) {
  return (
    <UiCard
      data-slot="app-card"
      className={cn(
        "block gap-0 rounded-xl p-5.5 text-body shadow-none animate-in duration-200 fade-in-0 slide-in-from-bottom-1",
        className,
      )}
      {...props}
    />
  );
}

/** Title, description and actions for a card, wrapping on narrow screens. */
export function CardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <CardHeader className="mb-3.5 flex items-start justify-between gap-3 px-0 phone:flex-wrap">
      <div>
        <h2 data-slot="card-title" className={cn(cardTitle, "mb-1")}>
          {title}
        </h2>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </CardHeader>
  );
}

/** A product card with an optional title, description and header action. */
export function Card({
  title,
  description,
  action,
  className,
  tour,
  children,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** A `data-tour` anchor, when a tour points at this card. */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <Panel className={className} data-tour={tour}>
      {title ? (
        <CardHeading title={title} description={description} action={action} />
      ) : null}
      {children}
    </Panel>
  );
}

/**
 * Says there is nothing here yet: what the place is for, in a sentence or
 * two, and the one next step. A card of its own, or `inline` inside one
 * (an Insights section), where its heading is a level lower.
 */
export function EmptyState({
  title,
  children,
  action,
  inline = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  inline?: boolean;
}) {
  const Heading = inline ? "h3" : "h2";
  const content = (
    <>
      <Heading className={cn(dialogTitle, "mb-1.5")}>{title}</Heading>
      <p className="max-w-160 text-sm leading-normal text-muted-foreground">
        {children}
      </p>
      {action ? (
        <div className="mt-3.5 flex flex-wrap gap-2">{action}</div>
      ) : null}
    </>
  );
  return inline ? (
    <div data-slot="empty-state" className="py-2">
      {content}
    </div>
  ) : (
    <Panel data-slot="empty-state">{content}</Panel>
  );
}

/** FactList's grid and its labels, shared with FactListSkeleton. */
export const factList = "grid grid-cols-2 gap-x-6 gap-y-3.5 phone:grid-cols-1";
export const factLabel = "mb-0.75 text-xs text-muted-foreground";

/** Label and value pairs, two columns where there is room. */
export function FactList({
  facts,
}: {
  facts: { label: string; value: ReactNode }[];
}) {
  return (
    <dl data-slot="fact-list" className={factList}>
      {facts.map(({ label, value }) => (
        <div key={label}>
          <dt className={cn(factLabel, "first-letter:uppercase")}>{label}</dt>
          <dd className="text-ui [overflow-wrap:anywhere] text-body">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Secondary explanation, collapsed so limits are available but not noisy. */
export function Disclosure({
  summary,
  children,
}: {
  summary: string;
  children: ReactNode;
}) {
  return (
    <details className="group mt-3.5 border-t pt-2.75">
      <summary
        className={cn(
          "cursor-pointer rounded-sm text-xs font-semibold text-body",
          focusRing,
        )}
      >
        {summary}
      </summary>
      <div className="mt-2 max-w-182.5 text-xs leading-[1.55] text-muted-foreground group-open:animate-in group-open:fade-in-0">
        {children}
      </div>
    </details>
  );
}

/** A row of buttons or links under a card's content. */
export function CardActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-actions"
      className={cn("mt-3.5 flex flex-wrap items-start gap-2", className)}
      {...props}
    />
  );
}

/**
 * Links or buttons in a card header, wrapping on narrow screens. Links are
 * TextLinks: the primary one last, any others `variant="quiet"`.
 */
export function CardLinks({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2.5 text-xs">
      {children}
    </div>
  );
}
