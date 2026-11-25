import { ListSkeleton } from "@/components/app/skeleton-lists";
import {
  ButtonSkeleton,
  CardSkeleton,
  LineSkeleton,
  LoadingPage,
  skeletonKeys,
} from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { tileClass } from "./section";

/** A tile: label, figure, and either detail lines or the trend's bars. */
function TileSkeleton({ bars = false }: { bars?: boolean }) {
  return (
    <div className={tileClass}>
      <LineSkeleton className="w-28 text-micro" />
      <LineSkeleton className="mt-1 w-20 text-figure leading-[1.15]" />
      {bars ? (
        <Skeleton className="mt-3 h-8 w-full rounded-sm" />
      ) : (
        <>
          <LineSkeleton className="mt-1.5 w-3/4 text-xs" />
          <LineSkeleton className="w-1/2 text-xs" />
        </>
      )}
    </div>
  );
}

export function HealthSkeleton() {
  return (
    <LoadingPage label="health">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3">
        {skeletonKeys(3).map((index) => (
          <TileSkeleton key={index} />
        ))}
      </div>
    </LoadingPage>
  );
}

export function TodaySkeleton() {
  return (
    <LoadingPage label="today's counts">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
        {skeletonKeys(4).map((index) => (
          <TileSkeleton key={index} bars />
        ))}
      </div>
    </LoadingPage>
  );
}

/** A card of ruled rows: Active runs, or Recent decisions with `dot`. */
export function ListCardSkeleton({
  label,
  dot = false,
}: {
  label: string;
  dot?: boolean;
}) {
  return (
    <LoadingPage label={label}>
      <CardSkeleton
        action={
          dot ? (
            <ButtonSkeleton size="sm" className="w-28" />
          ) : (
            <LineSkeleton className="w-14 text-xs" />
          )
        }
      >
        <ListSkeleton rows={5} dot={dot} trailing />
      </CardSkeleton>
    </LoadingPage>
  );
}

/** Everything under the header, while the page decides what to show. */
export function OverviewBodySkeleton() {
  return (
    <div className="grid gap-4">
      <HealthSkeleton />
      <TodaySkeleton />
      <div className={bottomGrid}>
        <ListCardSkeleton label="active runs" />
        <ListCardSkeleton label="recent decisions" dot />
      </div>
    </div>
  );
}

/** Active runs beside recent decisions where there is room. */
export const bottomGrid =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] items-start gap-4 *:min-w-0";
