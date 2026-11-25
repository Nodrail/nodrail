"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { DataToolbar } from "@/components/app/data-table";
import { FilterSelect, SearchField } from "@/components/app/list-filters";
import { Button } from "@/components/ui/button";
import type {
  ActivityKind,
  ActivityQuery,
  ActivityRange,
  ActivityView,
  OutcomeFilter,
} from "@/contracts/v1/activity-query";
import { activityHref, clearedQuery } from "../filters";
import { mismatchLabel } from "../presentation";
import { FiltersSheet, usePhone } from "./filters-sheet";

const kindOptions: { value: ActivityKind; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "decisions", label: "Authorization decisions" },
  { value: "reports", label: "With client report" },
  { value: "mismatches", label: mismatchLabel },
  { value: "changes", label: "Workspace changes" },
];

const outcomeOptions: { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "Any outcome" },
  { value: "allowed", label: "Allowed" },
  { value: "denied", label: "Denied" },
  { value: "held", label: "Denied by a gate or budget" },
];

const rangeOptions: { value: ActivityRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** Every agent this person can see, and the one in the URL even if not. */
function agentOptions(agents: string[], current: string) {
  const keys =
    current && !agents.includes(current) ? [current, ...agents] : agents;
  return [
    { value: "", label: "All agents" },
    ...keys.map((key) => ({ value: key, label: key })),
  ];
}

/** The dropdowns: agent, outcome and range for both views, kind for events. */
function Selects({
  view,
  shown,
  agents,
  onChange: change,
}: {
  view: ActivityView;
  shown: ActivityQuery;
  agents: string[];
  onChange: (part: Partial<ActivityQuery>) => void;
}) {
  return (
    <>
      <FilterSelect
        id="activity-agent"
        label="Agent"
        options={agentOptions(agents, shown.agent)}
        value={shown.agent}
        onChange={(agent) => change({ agent })}
      />
      <FilterSelect
        id="activity-outcome"
        label="Outcome"
        options={outcomeOptions}
        value={shown.outcome}
        onChange={(outcome) => change({ outcome })}
      />
      <FilterSelect
        id="activity-range"
        label="Time range"
        options={rangeOptions}
        value={shown.range}
        onChange={(range) => change({ range })}
      />
      {view === "events" ? (
        <FilterSelect
          id="activity-kind"
          label="Event kind"
          options={kindOptions}
          value={shown.kind}
          onChange={(kind) => change({ kind })}
        />
      ) : null}
    </>
  );
}

/** The run the events are narrowed to, as a button that widens them again. */
function RunChip({ name, onClear }: { name: string; onClear: () => void }) {
  return (
    <Button
      type="button"
      variant="secondary"
      aria-label={`Run ${name}: show every run`}
      className="max-w-full"
      onClick={onClear}
    >
      <span className="truncate">Run {name}</span>
      <X aria-hidden="true" />
    </Button>
  );
}

/** How long typing pauses before the list follows it. */
export const SEARCH_DELAY_MS = 350;

/** How many filters, besides the search, narrow this view now. */
export function filterCount(query: ActivityQuery, view: ActivityView) {
  return [
    query.agent !== "",
    query.outcome !== "all",
    query.range !== "all",
    view === "events" && query.kind !== "all",
    view === "events" && query.run !== "",
  ].filter(Boolean).length;
}

/** Runs `search` once typing has paused, unless the list already shows it. */
function useSearchAsYouType(typed: string, shown: string, search: () => void) {
  const latest = useRef(search);
  useEffect(() => {
    latest.current = search;
  });
  useEffect(() => {
    if (typed === shown) return;
    const timer = window.setTimeout(() => latest.current(), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [typed, shown]);
}

/** The filters themselves: inline on a wide screen, in a sheet on a phone. */
function FilterControls({
  phone,
  count,
  children,
}: {
  phone: boolean;
  count: number;
  children: ReactNode;
}) {
  return phone ? (
    <FiltersSheet count={count}>{children}</FiltersSheet>
  ) : (
    <>{children}</>
  );
}

/**
 * The URL holds the filters, so a filtered view can be linked, and both views
 * share them. The list follows the search a moment after typing pauses, or
 * at once on Enter; a reply that comes back late never erases what has been
 * typed since.
 */
export function ActivityFilters({
  path,
  view = "events",
  query,
  agents = [],
  runKey = null,
}: {
  path: string;
  view?: ActivityView;
  query: ActivityQuery;
  agents?: string[];
  /** The run the events are narrowed to, by name. */
  runKey?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [shown, showNext] = useOptimistic(query);
  const [term, setTerm] = useState(query.q);
  const [lastQuery, setLastQuery] = useState(query.q);
  const [requested, setRequested] = useState(query.q);
  if (lastQuery !== query.q) {
    setLastQuery(query.q);
    // Only a change from elsewhere, such as the back button. A slow reply to
    // this form's own request must not erase what has been typed since.
    if (query.q !== requested) setTerm(query.q);
  }

  function apply(next: ActivityQuery) {
    setRequested(next.q);
    startTransition(() => {
      showNext(next);
      // A new filter starts again from the newest.
      router.replace(activityHref(path, { ...next, cursor: undefined }, view));
    });
  }
  const change = (part: Partial<ActivityQuery>) =>
    apply({ ...shown, q: term.trim(), ...part });
  useSearchAsYouType(term.trim(), shown.q, () => change({}));
  const phone = usePhone();

  return (
    <DataToolbar
      as="form"
      role="search"
      data-tour="activity-filters"
      onSubmit={(event) => {
        event.preventDefault();
        change({});
      }}
    >
      <SearchField
        label={view === "runs" ? "Search runs" : "Search activity"}
        placeholder={
          view === "runs"
            ? "Search run, installation or agent"
            : "Search agent, action, resource, run or request ID"
        }
        value={term}
        onChange={setTerm}
      />
      <FilterControls phone={phone} count={filterCount(shown, view)}>
        <Selects view={view} shown={shown} agents={agents} onChange={change} />
        {view === "events" && shown.run ? (
          <RunChip
            name={runKey ?? shown.run}
            onClear={() => change({ run: "" })}
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setTerm("");
            apply(clearedQuery);
          }}
        >
          Clear
        </Button>
      </FilterControls>
    </DataToolbar>
  );
}
