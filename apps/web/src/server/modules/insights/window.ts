import "server-only";
import type { ReportWindow } from "@/contracts/v1/reports";
import type { WorkspaceContext } from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";

/**
 * The start of a window, as every Insights query writes it; `$3` is its days.
 * `now()`, not `clock_timestamp()`: a volatile bound cannot be an index
 * condition, so the range on created_at or occurred_at would be a filter.
 */
export const windowStart = "now() - make_interval(days => $3)";

/**
 * One environment's window, as the first three parameters of every Insights
 * query: workspace, environment, days. Unknown environments are NOT_FOUND.
 */
export async function windowArgs(
  context: WorkspaceContext,
  environmentSlug: string,
  days: ReportWindow,
) {
  const environment = await findEnvironment(context, environmentSlug);
  return {
    environment,
    args: [context.workspaceId, environment.id, days] as unknown[],
  };
}
