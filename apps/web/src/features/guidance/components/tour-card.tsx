"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { cardTitle, eyebrow, focusRing } from "@/components/app/styles";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import type { TourKey } from "@/contracts/v1/guidance";
import { cn } from "@/lib/utils";
import { tours } from "../tours";
import { keepTabInside, useTourAnchor } from "./tour-anchor";

/** How a tour ended; "off" also asks for no tour to open by itself again. */
export type TourEnd = "completed" | "skipped" | "off";

/** Gives focus back where it was, or to the page if that is gone. */
function giveFocusBack(element: HTMLElement | null) {
  if (element?.isConnected && element.getClientRects().length > 0) {
    element.focus({ preventScroll: true });
    return;
  }
  document.getElementById("page")?.focus({ preventScroll: true });
}

/**
 * Skip, Back and Next (Done on the last step); Next has focus. The first
 * step also offers to keep tours from opening by themselves.
 */
function TourButtons({
  primary,
  step,
  last,
  onMove,
  onEnd,
}: {
  primary: RefObject<HTMLButtonElement | null>;
  step: number;
  last: boolean;
  onMove: (step: number) => void;
  onEnd: (how: TourEnd) => void;
}) {
  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onEnd("skipped")}
        >
          Skip tour
        </Button>
        <div className="flex gap-2">
          {step > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onMove(step - 1)}
            >
              Back
            </Button>
          ) : null}
          <Button
            ref={primary}
            type="button"
            size="sm"
            onClick={() => (last ? onEnd("completed") : onMove(step + 1))}
          >
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
      {step === 0 ? <ToursOff onEnd={onEnd} /> : null}
    </>
  );
}

/** On a tour's first card: end it, and let no tour open by itself again. */
function ToursOff({ onEnd }: { onEnd: (how: TourEnd) => void }) {
  return (
    <button
      type="button"
      data-slot="tours-off"
      className={cn(
        "mt-3 rounded-sm text-xs text-muted-foreground underline hover:text-foreground",
        focusRing,
      )}
      onClick={() => onEnd("off")}
    >
      Don&apos;t show tours
    </button>
  );
}

/**
 * One step of a tour, next to the element it is about, or in the middle of
 * the window when the page does not show it. A dialog that keeps Tab inside;
 * Escape, Skip or a click elsewhere ends the tour, and focus goes back.
 */
export function TourCard({
  tour,
  returnFocus,
  onEnd,
}: {
  tour: TourKey;
  returnFocus: HTMLElement | null;
  onEnd: (how: TourEnd) => void;
}) {
  const { label, steps } = tours[tour];
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const last = index === steps.length - 1;
  const { target, anchor } = useTourAnchor(step?.anchor ?? "");
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Each step announces itself: focus lands on its main button.
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, [index]);

  if (!step) return null;
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onEnd("skipped");
      }}
    >
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        data-slot="tour"
        data-tour-key={tour}
        data-placement={target ? "anchored" : "centered"}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        side="bottom"
        align={target ? "start" : "center"}
        sideOffset={target ? 10 : 0}
        collisionPadding={12}
        avoidCollisions={Boolean(target)}
        className={cn(
          "w-[min(22rem,calc(100vw-2rem))] rounded-xl p-5 text-body shadow-lg shadow-ink/15",
          !target && "-translate-y-1/2",
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primary.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          giveFocusBack(returnFocus);
        }}
        onKeyDown={keepTabInside}
      >
        <p data-slot="tour-progress" className={cn("mb-2", eyebrow)}>
          {label} · Step {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className={cn(cardTitle, "mb-1.5")}>
          {step.title}
        </h2>
        <p id={bodyId} className="text-ui leading-normal text-muted-foreground">
          {step.body}
        </p>
        <TourButtons
          primary={primary}
          step={index}
          last={last}
          onMove={setIndex}
          onEnd={onEnd}
        />
      </PopoverContent>
    </Popover>
  );
}
