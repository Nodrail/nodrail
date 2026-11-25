import { z } from "zod";

/**
 * Activity's views: each Cloud event, the runs they belong to, or what
 * installations reported their local hooks did (evidence, not Cloud state).
 */
export const activityViews = ["events", "runs", "local"] as const;
/**
 * What kind of event: decisions, those with a client report, those whose
 * report says an action ran that Nodrail never allowed, or changes.
 */
export const activityKinds = [
  "all",
  "decisions",
  "reports",
  "mismatches",
  "changes",
] as const;
/** What happened to the action; "held" is any action a gate or budget held. */
export const outcomeFilters = ["all", "allowed", "denied", "held"] as const;
export const activityRanges = ["all", "24h", "7d", "30d"] as const;

export type ActivityView = (typeof activityViews)[number];
export type ActivityKind = (typeof activityKinds)[number];
export type OutcomeFilter = (typeof outcomeFilters)[number];
export type ActivityRange = (typeof activityRanges)[number];

/** How far back each range reaches, as a Postgres interval. */
export const rangeIntervals: Record<Exclude<ActivityRange, "all">, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/**
 * Read from the URL, so anything unrecognised means "no filter". A run that
 * is not a run is the exception: the page answers 404 for it.
 */
export const activityQuery = z.object({
  kind: z.enum(activityKinds).catch("all"),
  outcome: z.enum(outcomeFilters).catch("all"),
  agent: z.string().trim().max(100).catch(""),
  run: z.string().trim().max(64).catch(""),
  range: z.enum(activityRanges).catch("all"),
  q: z.string().trim().max(200).catch(""),
  cursor: z.string().max(200).optional().catch(undefined),
});

export type ActivityQuery = z.infer<typeof activityQuery>;

/** Most events an export carries: the newest that match. */
export const EXPORT_LIMIT = 10_000;
export const exportFormats = ["csv", "json"] as const;
export type ExportFormat = (typeof exportFormats)[number];
