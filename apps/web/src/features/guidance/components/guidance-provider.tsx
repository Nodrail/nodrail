"use client";

import {
  createContext,
  use,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { track } from "@/components/analytics/posthog";
import {
  TOURS_OFF_KEY,
  tourGuidanceKey,
  type GuidanceDto,
  type TourKey,
} from "@/contracts/v1/guidance";
import { markGuidanceAction } from "../actions";
import { TourCard, type TourEnd } from "./tour-card";

type StartOptions = {
  /** Where focus goes when the tour ends; by default, where it was. */
  returnFocus?: HTMLElement | null;
};

export type Guidance = {
  /** Whether this person has seen the key, and its value if it keeps one. */
  seen: (key: string) => boolean;
  valueOf: (key: string) => string | null;
  /** Records it, here at once; settles once the server has it too. */
  mark: (key: string, value?: string | null) => Promise<unknown>;
  startTour: (tour: TourKey, options?: StartOptions) => void;
  activeTour: TourKey | null;
};

/** Outside a workspace (and in isolated tests) guidance does nothing. */
const inert: Guidance = {
  seen: () => true,
  valueOf: () => null,
  mark: async () => undefined,
  startTour: () => undefined,
  activeTour: null,
};

const GuidanceContext = createContext<Guidance>(inert);

export const useGuidance = () => use(GuidanceContext);

type Active = { tour: TourKey; returnFocus: HTMLElement | null };

/**
 * What this person has seen of tours, first steps and "What's new", and the
 * one tour that may be open. Starting a tour records it as seen, so a tour
 * shown once (finished, skipped or closed) never opens by itself again.
 */
export function GuidanceProvider({
  initial,
  children,
}: {
  initial: GuidanceDto;
  children: ReactNode;
}) {
  const [known, setKnown] = useState(initial);
  const [active, setActive] = useState<Active | null>(null);
  const running = useRef<TourKey | null>(null);

  const mark = useCallback((key: string, value: string | null = null) => {
    setKnown((current) =>
      key in current && current[key] === value
        ? current
        : { ...current, [key]: value },
    );
    return markGuidanceAction({ key, value });
  }, []);

  const startTour = useCallback(
    (tour: TourKey, options: StartOptions = {}) => {
      if (running.current) return;
      running.current = tour;
      const focused = document.activeElement;
      setActive({
        tour,
        returnFocus:
          options.returnFocus ??
          (focused instanceof HTMLElement && focused !== document.body
            ? focused
            : null),
      });
      track("tour_started", { tour });
      void mark(tourGuidanceKey(tour));
    },
    [mark],
  );

  const end = useCallback(
    (tour: TourKey, how: TourEnd) => {
      running.current = null;
      setActive(null);
      track(how === "completed" ? "tour_completed" : "tour_skipped", { tour });
      // Help still offers every tour; none opens by itself any more.
      if (how === "off") void mark(TOURS_OFF_KEY);
    },
    [mark],
  );

  const value = useMemo<Guidance>(
    () => ({
      seen: (key) => key in known,
      valueOf: (key) => known[key] ?? null,
      mark,
      startTour,
      activeTour: active?.tour ?? null,
    }),
    [known, mark, startTour, active],
  );

  return (
    <GuidanceContext value={value}>
      {children}
      {active ? (
        <TourCard
          key={active.tour}
          tour={active.tour}
          returnFocus={active.returnFocus}
          onEnd={(how) => end(active.tour, how)}
        />
      ) : null}
    </GuidanceContext>
  );
}
