import {
  activityKinds,
  activityQuery,
  activityViews,
  type ActivityKind,
  type ActivityQuery,
  type ActivityView,
} from "@/contracts/v1/activity-query";

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const isView = (value: unknown): value is ActivityView =>
  activityViews.includes(value as ActivityView);
const isKind = (value: unknown): value is ActivityKind =>
  activityKinds.includes(value as ActivityKind);

/**
 * Activity's address: the view, the filters and the open event. `view` once
 * held the kind of event, so an old `?view=changes` still filters by kind.
 */
export function readActivityParams(raw: RawParams) {
  const view = first(raw.view);
  const legacyKind = isKind(view) && !raw.kind ? view : undefined;
  const query = activityQuery.parse({
    kind: legacyKind ?? first(raw.kind),
    outcome: first(raw.outcome),
    agent: first(raw.agent),
    run: first(raw.run),
    range: first(raw.range),
    q: first(raw.q),
    check_token: first(raw.check_token),
    cursor: first(raw.cursor),
  });
  return {
    view: isView(view) ? view : ("events" as const),
    query,
    event: first(raw.event) || undefined,
  };
}

/** The filters each view reads. Runs have no kind, and a run is its own page. */
export function filtersFor(
  query: ActivityQuery,
  view: ActivityView,
): ActivityQuery {
  if (view === "local") return activityQuery.parse({});
  return view === "runs"
    ? { ...query, kind: "all", run: "", check_token: undefined }
    : query;
}

/** A link to Activity. Filters left at their default stay out of the URL. */
export function activityHref(
  path: string,
  query: ActivityQuery,
  view: ActivityView = "events",
) {
  const { kind, outcome, agent, run, range, q, check_token, cursor } =
    filtersFor(query, view);
  const params = new URLSearchParams();
  if (view !== "events") params.set("view", view);
  if (kind !== "all") params.set("kind", kind);
  if (outcome !== "all") params.set("outcome", outcome);
  if (agent) params.set("agent", agent);
  if (run) params.set("run", run);
  if (range !== "all") params.set("range", range);
  if (q) params.set("q", q);
  if (check_token) params.set("check_token", check_token);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const clearedQuery: ActivityQuery = activityQuery.parse({});

/** Whether anything narrows this view, so an empty list is a non-match. */
export function isFiltered(
  query: ActivityQuery,
  view: ActivityView = "events",
) {
  const { kind, outcome, agent, run, range, q, check_token } = filtersFor(
    query,
    view,
  );
  return Boolean(
    kind !== "all" ||
    outcome !== "all" ||
    agent ||
    run ||
    range !== "all" ||
    q ||
    check_token,
  );
}

/** The export of what this list shows, from the newest, as `format`. */
export function exportHref(
  path: string,
  query: ActivityQuery,
  format: "csv" | "json",
) {
  const href = activityHref(`${path}/export`, { ...query, cursor: undefined });
  return `${href}${href.includes("?") ? "&" : "?"}format=${format}`;
}
