"use client";

import { CircleHelp } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  TOURS_OFF_KEY,
  autoTours,
  tourGuidanceKey,
  type TourKey,
} from "@/contracts/v1/guidance";
import { cn } from "@/lib/utils";
import { useGuidance } from "./guidance-provider";

/** Long enough for the page's own entrance to settle under the first step. */
const SETTLE_MS = 400;

/**
 * Opens Overview's tour by itself the first time this person
 * sees the screen with something on it; never on an empty one, never again,
 * and never once they asked for no tours. Other screens' tours wait in Help,
 * so this does nothing for them.
 */
export function PageTour({ tour, ready }: { tour: TourKey; ready: boolean }) {
  const { seen, startTour } = useGuidance();
  const due =
    ready &&
    autoTours.includes(tour) &&
    !seen(TOURS_OFF_KEY) &&
    !seen(tourGuidanceKey(tour));

  useEffect(() => {
    if (!due) return;
    const timer = setTimeout(() => startTour(tour), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [due, tour, startTour]);

  return null;
}

/**
 * Starts a tour again from a dialog or side panel, where the top bar's Help
 * menu cannot be reached.
 */
export function TourButton({
  tour,
  label,
  className,
}: {
  tour: TourKey;
  /** What the tour is about: "Take the tour of this request". */
  label: string;
  className?: string;
}) {
  const { startTour } = useGuidance();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-slot="tour-button"
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground", className)}
      onClick={(event) => startTour(tour, { returnFocus: event.currentTarget })}
    >
      <CircleHelp aria-hidden="true" />
    </Button>
  );
}

/**
 * For a dialog or side panel a tour points into: a click on the tour's card
 * is not a click outside the dialog, so it stays open.
 */
export function keepOpenForTour(event: {
  target: EventTarget | null;
  preventDefault: () => void;
}) {
  if (
    event.target instanceof Element &&
    event.target.closest("[data-slot=tour]")
  )
    event.preventDefault();
}
