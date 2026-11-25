import type { ReactNode } from "react";
import { Card } from "@/components/app/card";
import {
  DataActionsCell,
  DataActionsHeading,
  DataEmpty,
  DataTable,
} from "@/components/app/data-table";
import { figure, groupHeading } from "@/components/app/styles";
import { TextLink } from "@/components/app/text-link";
import { toneLooks, type Tone } from "@/components/app/tones";
import { cn } from "@/lib/utils";

/**
 * One Insights section: a question as its title, the numbers that answer it,
 * and what to do about them. A region, so it can be found by its question.
 */
export function InsightSection({
  id,
  tour,
  question,
  description,
  action,
  children,
}: {
  id?: string;
  /** The name a guided tour points at it by. */
  tour?: string;
  question: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-tour={tour}
      aria-label={question}
      className="scroll-mt-4"
    >
      <Card title={question} description={description} action={action}>
        {children}
      </Card>
    </section>
  );
}

/** `value` null when there is nothing to measure yet: a dash, and the hint says why. */
export type Figure = { label: string; value: ReactNode | null; hint?: string };

/** Nothing to measure, as a figure: a dash to the eye, "None" when read out. */
const noFigure = (
  <>
    <span aria-hidden="true">—</span>
    <span className="sr-only">None</span>
  </>
);

/** A row of numbers with plain labels; each number pops when it changes. */
export function Figures({ figures }: { figures: Figure[] }) {
  return (
    <dl
      data-slot="insight-figures"
      className="stagger mb-4 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-6 gap-y-3.5 last:mb-0"
    >
      {figures.map(({ label, value, hint }) => (
        <div key={label}>
          <dt className="mb-0.75 text-xs text-muted-foreground first-letter:uppercase">
            {label}
          </dt>
          <dd
            key={typeof value === "string" ? value : undefined}
            className={cn("inline-block animate-pop", figure)}
          >
            {value ?? noFigure}
          </dd>
          {hint ? (
            <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export type BarPart = {
  label: string;
  value: number;
  tone: Tone;
};

/**
 * How a whole splits, as one bar with a key under it. The bar is decoration;
 * the key carries the numbers for everyone.
 */
export function SplitBar({ parts }: { parts: BarPart[] }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  const shown = parts.filter((part) => part.value > 0);
  return (
    <div data-slot="split-bar" className="mb-4 last:mb-0">
      <div
        aria-hidden="true"
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        {shown.map((part) => (
          <span
            key={part.label}
            className={cn(
              "h-full origin-left animate-in duration-500 fade-in-0",
              toneLooks[part.tone].fill,
            )}
            style={{ width: `${(part.value / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {shown.map((part) => (
          <li key={part.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn("size-2 rounded-full", toneLooks[part.tone].fill)}
            />
            {part.label} <b className="text-foreground">{part.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A thin bar showing a value against the largest in its list, for a table
 * cell. Hidden from assistive technology: the number beside it says it.
 */
export function Meter({
  value,
  max,
  tone = "success",
}: {
  value: number;
  max: number;
  tone?: Tone;
}) {
  const width = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <span
      aria-hidden="true"
      className="mt-1 block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted"
    >
      <span
        className={cn(
          "block h-full origin-left animate-in rounded-full duration-500 fade-in-0",
          toneLooks[tone].fill,
        )}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

/** A small heading inside a section, above a list. */
export function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className={cn("mt-5 mb-2 first:mt-0", groupHeading)}>{children}</h3>
  );
}

/**
 * A section's table: plain headings, an unnamed last column when rows have
 * actions, or, when `empty` says why, that line instead.
 */
export function InsightTable({
  label,
  headings,
  actions = false,
  empty = null,
  children,
}: {
  label: string;
  headings: string[];
  actions?: boolean;
  empty?: ReactNode;
  children: ReactNode;
}) {
  if (empty) return <DataEmpty>{empty}</DataEmpty>;
  return (
    <DataTable aria-label={label}>
      <thead>
        <tr>
          {headings.map((heading) => (
            <th key={heading} scope="col">
              {heading}
            </th>
          ))}
          {actions ? <DataActionsHeading /> : null}
        </tr>
      </thead>
      <tbody className="stagger">{children}</tbody>
    </DataTable>
  );
}

/** A row's next step, as a link in its last cell. */
export function RowAction({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <DataActionsCell>
      <TextLink href={href} size="xs">
        {children}
      </TextLink>
    </DataActionsCell>
  );
}
