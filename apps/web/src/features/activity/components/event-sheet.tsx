"use client";

import { useState } from "react";
import { Note } from "@/components/app/note";
import {
  CardSkeleton,
  FactListSkeleton,
  LoadingPage,
} from "@/components/app/skeletons";
import { StatusBadge } from "@/components/app/status-badge";
import { dialogTitle } from "@/components/app/styles";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  ActivityDetailDto,
  ActivityEventDto,
} from "@/contracts/v1/activity";
import {
  TourButton,
  keepOpenForTour,
} from "@/features/guidance/components/page-tour";
import { cn } from "@/lib/utils";
import { eventTitle, outcomeTones } from "../presentation";
import { EventDetail } from "./event-detail";

/** What the panel has for the open event while and after it loads. */
export type OpenEvent = {
  id: string;
  /** The row from the list, shown while the rest loads. */
  summary: ActivityEventDto | null;
  /** The whole event, null while loading, "missing" when it cannot be seen. */
  detail: ActivityDetailDto | "missing" | null;
};

function SheetBody({ base, shown }: { base: string; shown: OpenEvent }) {
  if (shown.detail === "missing")
    return (
      <Note tone="plain">
        This event no longer exists, or it concerns an agent not assigned to
        you.
      </Note>
    );
  if (shown.detail) return <EventDetail base={base} event={shown.detail} />;
  return (
    <LoadingPage label="event">
      <div className="grid gap-4">
        <CardSkeleton description>
          <FactListSkeleton rows={6} />
        </CardSkeleton>
        <CardSkeleton description lines={1} />
      </div>
    </LoadingPage>
  );
}

/** The event's title and outcome, from the list row until the rest loads. */
function EventHeading({
  shown,
  loaded,
}: {
  shown: OpenEvent;
  loaded: boolean;
}) {
  const heading =
    shown.detail && shown.detail !== "missing" ? shown.detail : shown.summary;
  return (
    <SheetHeader className="gap-1 border-b bg-card p-5 pr-12 phone:p-4 phone:pr-12">
      <div className="flex flex-wrap items-center gap-2">
        <SheetTitle className={cn(dialogTitle, "[overflow-wrap:anywhere]")}>
          {heading ? eventTitle(heading) : "Event"}
        </SheetTitle>
        {heading ? (
          <StatusBadge tone={outcomeTones[heading.outcome]}>
            {heading.label}
          </StatusBadge>
        ) : null}
        {loaded ? (
          <TourButton
            tour="event"
            label="Take the tour of this event"
            className="-my-1 ml-auto"
          />
        ) : null}
      </div>
      <SheetDescription className="text-ui">
        {heading?.environment ?? "All environments"}
      </SheetDescription>
    </SheetHeader>
  );
}

/**
 * One event in a panel on the right, over the list; the whole screen on a
 * phone. Escape, the close button and Back all close it.
 */
export function EventSheet({
  base,
  event,
  onClose,
}: {
  base: string;
  event: OpenEvent | null;
  onClose: () => void;
}) {
  // The last event stays rendered while the panel slides out.
  const [shown, setShown] = useState(event);
  if (event && event !== shown) setShown(event);
  const loaded = Boolean(shown?.detail && shown.detail !== "missing");
  return (
    <Sheet
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {shown ? (
        <SheetContent
          data-slot="event-sheet"
          className="w-full gap-0 overflow-y-auto bg-background text-body sm:max-w-[38rem] phone:max-w-none! phone:border-0"
          onInteractOutside={keepOpenForTour}
        >
          <EventHeading shown={shown} loaded={loaded} />
          <div className="p-5 phone:p-4">
            <SheetBody base={base} shown={shown} />
          </div>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}
