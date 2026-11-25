import type { ReportWindow, ShareDto, SpendDto } from "@/contracts/v1/reports";

/** "1 of 3 (33%)"; with nothing to count, "0 of 0" and no percentage. */
export function shareLabel({ count, of }: ShareDto) {
  if (!of) return "0 of 0";
  return `${count} of ${of} (${percent({ count, of })}%)`;
}

/** A share as a whole percentage, 0 when there is nothing to count. */
export const percent = ({ count, of }: ShareDto) =>
  of ? Math.round((count / of) * 100) : 0;

/** "3", "3.5"; no runs, no median. */
export const medianLabel = (median: number | null) =>
  median === null ? "None" : String(Math.round(median * 10) / 10);

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "$1.80 · 41K tokens"; "None" when no receipt reported spending. */
export function spendLabel({ usd, tokens }: SpendDto) {
  const parts = [
    ...(usd > 0 ? [`$${usd.toFixed(2)}`] : []),
    ...(tokens > 0 ? [`${compact.format(tokens)} tokens`] : []),
  ];
  return parts.length ? parts.join(" · ") : "None";
}

export const reportsPath = (base: string, days?: ReportWindow) =>
  `${base}/insights${days ? `?days=${days}` : ""}`;
