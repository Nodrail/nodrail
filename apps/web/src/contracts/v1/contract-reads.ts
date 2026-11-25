import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SELECTOR_DAYS,
  MAX_SELECTOR_FILTERS,
  contractDigest,
  contractSurfaces,
  shapePath,
} from "./declared-contracts";
import {
  authorities,
  captureStates,
  validationStates,
  type Authority,
  type ContractEventDto,
} from "./contract-events";
import { isDate } from "./shapes-engine";

/**
 * Reading declared-contract events: pages that say when they are
 * incomplete, and bounded Insights selections over a projection's declared
 * fields, with every denominator.
 */

// ── Reading: paging, completeness and selectors ────────────────────────────

/** Why a page or an aggregation may not be the whole picture. */
export const incompleteReasons = [
  /** More rows than one page; follow the cursor. */
  "more_pages",
  /** This person sees only their own reports (viewers). */
  "own_reports_only",
  /** Older events were removed by retention. */
  "retention",
  /** Some events name a contract whose schema is no longer here. */
  "schema_unavailable",
  /** Events of other contract revisions were left out of an aggregation. */
  "other_revisions",
] as const;
export type IncompleteReason = (typeof incompleteReasons)[number];

export type Completeness = {
  complete: boolean;
  reasons: IncompleteReason[];
};

export type ContractEventPageDto = {
  items: ContractEventDto[];
  /** Opaque; null on the last page. */
  nextCursor: string | null;
  completeness: Completeness;
};

/** The events API and pages: a typo is refused, never silently ignored. */
export const contractEventsQuery = z
  .object({
    surface: z.enum(contractSurfaces).optional(),
    contract: contractDigest.optional(),
    authority: z.enum(authorities).optional(),
    capture: z.enum(captureStates).optional(),
    validation: z.enum(validationStates).optional(),
    run: z.string().min(1).max(64).optional(),
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict();

/** A range bound: a number, or a quoted date for a `date` field. */
const rangeBound = z.union([
  z.number().finite(),
  z.string().refine(isDate, "a YYYY-MM-DD date"),
]);

/**
 * A `where` condition as the grammar has it: an exact value; `min`/`max`
 * on numbers or dates (both of one kind); `in` over enum, string or integer
 * values. The server checks the path's type against its projection.
 */
const selectorFilter = z
  .object({
    path: shapePath,
    equals: z
      .union([z.string().max(100), z.number().finite(), z.boolean()])
      .optional(),
    min: rangeBound.optional(),
    max: rangeBound.optional(),
    in: z
      .array(z.union([z.string().max(100), z.number().int()]))
      .min(1)
      .max(20)
      .optional(),
  })
  .strict()
  .refine(
    (filter) =>
      [
        filter.equals !== undefined,
        filter.min !== undefined || filter.max !== undefined,
        filter.in !== undefined,
      ].filter(Boolean).length === 1,
    "one of equals, a range, or in",
  )
  .refine(
    (filter) =>
      filter.min === undefined ||
      filter.max === undefined ||
      typeof filter.min === typeof filter.max,
    "a range of numbers or of dates",
  );

/**
 * An Insights selection over one projection's declared fields: a count, or
 * a numeric aggregate, optionally grouped by an enum or boolean field.
 * Paths must be fields of that projection; the server checks them.
 */
export const contractSelectorInput = z
  .object({
    projection: contractDigest,
    measure: z.discriminatedUnion("aggregate", [
      z.object({ aggregate: z.literal("count") }).strict(),
      z
        .object({
          aggregate: z.enum(["sum", "min", "max", "avg"]),
          path: shapePath,
        })
        .strict(),
    ]),
    group_by: shapePath.optional(),
    filters: z.array(selectorFilter).max(MAX_SELECTOR_FILTERS).default([]),
    days: z.coerce.number().int().min(1).max(MAX_SELECTOR_DAYS).default(30),
  })
  .strict();
export type ContractSelectorInput = z.infer<typeof contractSelectorInput>;

/** Every denominator, so missing never reads as success. */
export type SelectorCountsDto = {
  events: number;
  valid: number;
  invalid: number;
  missing: number;
  unsupported: number;
  /** Valid events without the measured value: optional and absent. */
  absent: number;
};

export type ContractSelectionDto = {
  projection: string;
  groups: {
    key: string | number | boolean | null;
    value: number | null;
    counts: SelectorCountsDto;
  }[];
  totals: SelectorCountsDto;
  /** Reported values are self-reported, never verified outcomes. */
  authority: Authority | "mixed";
  completeness: Completeness;
};
