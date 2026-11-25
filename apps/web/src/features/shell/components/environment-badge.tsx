import { StatusBadge } from "@/components/app/status-badge";

/** Production is where mistakes reach people: it never looks like Development. */
export const environmentTone = (slug: string) =>
  slug === "production" ? "warning" : "neutral";

/**
 * The Nodrail environment a page works in, as a chip; Production in the
 * warning tone. Select it by `[data-slot=environment-context]`.
 */
export function EnvironmentBadge({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  return (
    <span
      data-slot="environment-context"
      data-production={slug === "production" ? "" : undefined}
      className="shrink-0"
    >
      <StatusBadge tone={environmentTone(slug)}>{name}</StatusBadge>
    </span>
  );
}
