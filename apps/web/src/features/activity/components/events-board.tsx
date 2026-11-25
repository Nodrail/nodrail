"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useUrlSelection } from "@/components/app/use-url-selection";
import type {
  ActivityDetailDto,
  ActivityEventDto,
} from "@/contracts/v1/activity";
import type { ActivityQuery } from "@/contracts/v1/activity-query";
import { readActivityEvent } from "../actions";
import { activityHref } from "../filters";
import { ActivityTable, type EventMenu } from "./activity-table";
import { EventSheet, type OpenEvent } from "./event-sheet";
import { appPath } from "@/lib/product-path";

type Loaded = Record<string, ActivityDetailDto | "missing">;

/**
 * The events, and the one in `?event=` in a side panel. That event came with
 * the page when the link named it; one opened from the list loads here.
 */
export function EventsBoard({
  workspace,
  environment,
  items,
  selected,
  empty,
  query,
}: {
  workspace: string;
  environment: string;
  items: ActivityEventDto[];
  /** The filters in use, which "Filter by this agent" keeps. */
  query: ActivityQuery;
  /** The event in the URL, as loaded with the page. */
  selected: ActivityDetailDto | null;
  /** Shown in place of the table when no event matches. */
  empty: ReactNode;
}) {
  const { openId, urlFor, open, show } = useUrlSelection("event");
  const [loaded, setLoaded] = useState<Loaded>(() =>
    selected ? { [selected.id]: selected } : {},
  );
  const asked = useRef(new Set(selected ? [selected.id] : []));

  useEffect(() => {
    if (!openId || asked.current.has(openId)) return;
    asked.current.add(openId);
    void readActivityEvent(workspace, environment, openId).then(
      (found) => setLoaded((all) => ({ ...all, [openId]: found ?? "missing" })),
      () => asked.current.delete(openId),
    );
  }, [openId, workspace, environment]);

  // Kept the same object between renders, so the panel only moves on a change.
  const current = useMemo<OpenEvent | null>(
    () =>
      openId
        ? {
            id: openId,
            summary: items.find((item) => item.id === openId) ?? null,
            detail: loaded[openId] ?? null,
          }
        : null,
    [openId, items, loaded],
  );

  const base = appPath(workspace, environment);
  const menu: EventMenu = {
    base,
    agentHref: (agent) =>
      activityHref(`${base}/activity`, { ...query, agent, cursor: undefined }),
  };

  return (
    <>
      {items.length ? (
        <ActivityTable
          items={items}
          hrefFor={urlFor}
          onOpen={open}
          menu={menu}
        />
      ) : (
        empty
      )}
      <EventSheet base={base} event={current} onClose={() => show(null)} />
    </>
  );
}
