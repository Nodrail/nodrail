const units: [limit: number, seconds: number, unit: string][] = [
  [60, 60, "min"],
  [24, 3600, "hour"],
  [Infinity, 86400, "day"],
];

/** "2 min ago". Under a minute reads as "just now". */
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  for (const [limit, size, unit] of units) {
    const value = Math.floor(seconds / size);
    if (value < limit)
      return `${value} ${unit}${value === 1 || unit === "min" ? "" : "s"} ago`;
  }
  return "";
}

/** "23 min", "2 hours", "7 days" until a moment; never negative. */
export function timeUntil(iso: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - now) / 60000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "2026-11-09 07:09 UTC". History needs a moment that never changes. */
export const formatUtc = (iso: string) =>
  `${iso.slice(0, 16).replace("T", " ")} UTC`;
