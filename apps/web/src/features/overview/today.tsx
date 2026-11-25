import Link from "next/link";
import {
  todayOutcomes,
  type OutcomeTrendDto,
  type TodayDto,
  type TodayOutcome,
} from "@/contracts/v1/overview";
import { plural } from "@/lib/text";
import { Figure, TileLabel, linkedTileClass } from "./section";

const labels: Record<TodayOutcome, { title: string; trend: string }> = {
  allowed: { title: "Allowed", trend: "allowed" },
  denied: { title: "Denied", trend: "denied" },
  held: { title: "Denied by a gate or budget", trend: "held" },
};

const dayName = (daysAgo: number) =>
  daysAgo === 0 ? "in the last 24 hours" : `${plural(daysAgo, "day")} ago`;

/**
 * Seven thin bars, oldest first, scaled to the week's busiest day; the last is
 * the last 24 hours. Each says its figure on hover, and the whole series is
 * read out once, since the bars themselves are hidden from screen readers.
 */
export function TrendBars({ days, noun }: { days: number[]; noun: string }) {
  const peak = Math.max(1, ...days);
  const said = days
    .map((value, index) => `${value} ${dayName(days.length - 1 - index)}`)
    .reverse()
    .join(", ");
  return (
    <span data-slot="trend" className="mt-3 block">
      <span className="sr-only">
        Last 7 days, {noun}: {said}.
      </span>
      <span
        aria-hidden="true"
        className="flex h-8 items-end gap-0.5 border-b border-border"
      >
        {days.map((value, index) => (
          <span
            key={index}
            title={`${value} ${noun}, ${dayName(days.length - 1 - index)}`}
            className="flex h-full flex-1 items-end"
          >
            <span
              className={
                index === days.length - 1
                  ? "w-full rounded-t-[4px] bg-forest"
                  : "w-full rounded-t-[4px] bg-forest/35"
              }
              style={{
                height: value ? `${Math.max(8, (value / peak) * 100)}%` : "0",
              }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

function OutcomeTile({
  base,
  outcome,
  trend,
}: {
  base: string;
  outcome: TodayOutcome;
  trend: OutcomeTrendDto;
}) {
  const label = labels[outcome];
  return (
    <Link
      href={`${base}/activity?outcome=${outcome}&range=24h`}
      data-slot="today-count"
      data-outcome={outcome}
      className={linkedTileClass}
    >
      <TileLabel>{label.title}</TileLabel>
      <Figure value={trend.count.toLocaleString("en")} />
      <TrendBars days={trend.days} noun={label.trend} />
    </Link>
  );
}

/** What happened in the last 24 hours, against the week before. */
export function TodayCounts({
  base,
  today,
}: {
  base: string;
  today: TodayDto;
}) {
  return (
    <div
      data-slot="today-row"
      className="stagger grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3 *:min-w-0"
    >
      {todayOutcomes.map((outcome) => (
        <OutcomeTile
          key={outcome}
          base={base}
          outcome={outcome}
          trend={today[outcome]}
        />
      ))}
    </div>
  );
}
