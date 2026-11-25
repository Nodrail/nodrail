import "server-only";
import type { EntityManager } from "typeorm";
import { usageFrom, type PlanKey, type UsageDto } from "@/contracts/v1/billing";
import {
  crossedAt,
  recommendUpgrade,
  resetsAt,
  type UsageHistory,
  type UsageMetric,
  type UsageThreshold,
} from "@/contracts/v1/usage-alerts";
import type { RuntimeContext } from "@/server/db/context";
import { appPath } from "@/lib/product-path";
import { describeError } from "@/server/log";
import { enqueueNotification, placeNames } from "@/server/notifications/outbox";

type Scope = { manager: EntityManager; workspaceId: string };

/** Counts of the two months before this one, most recent first; none is 0. */
export async function usageHistory({
  manager,
  workspaceId,
}: Scope): Promise<UsageHistory> {
  const rows: { period: string; intents: number; steps: number }[] =
    await manager.query(
      `SELECT to_char(m.period, 'YYYY-MM') AS period,
              COALESCE(u.intents, 0) AS intents, COALESCE(u.steps, 0) AS steps
       FROM (SELECT (date_trunc('month', timezone('UTC', clock_timestamp()))
                     - make_interval(months => n))::date AS period
             FROM generate_series(1, 2) AS n) m
       LEFT JOIN nodrail.billing_usage u
         ON u.workspace_id = $1 AND u.period = m.period
       ORDER BY m.period DESC`,
      [workspaceId],
    );
  return {
    actions: rows.map((row) => ({ period: row.period, used: row.intents })),
    steps: rows.map((row) => ({ period: row.period, used: row.steps })),
  };
}

/** An email is about one allowance, so only that one's reasons count. */
async function recommendFor(
  scope: Scope,
  metric: UsageMetric,
  month: UsageDto,
) {
  const history = await usageHistory(scope);
  const none = usageFrom(0, month.limit);
  return recommendUpgrade({
    plan: "free",
    actions: metric === "actions" ? month : none,
    steps: metric === "steps" ? month : none,
    history: { actions: [], steps: [], [metric]: history[metric] },
    now: new Date(),
  });
}

type Crossing = {
  metric: UsageMetric;
  threshold: UsageThreshold;
  plan: PlanKey;
  used: number;
  limit: number;
  /** "2026-11-01": the month the count belongs to. */
  period: string;
};

/**
 * The first time this month a threshold is met, its row goes in and the people
 * who manage billing get an email; the key makes every later try a no-op.
 */
async function recordCrossing(context: RuntimeContext, crossing: Crossing) {
  const { manager, workspaceId } = context;
  const { metric, threshold, plan, used, limit, period } = crossing;
  const inserted: unknown[] = await manager.query(
    `INSERT INTO nodrail.usage_alerts
       (workspace_id, period, metric, threshold, used, allowance)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING 1`,
    [workspaceId, period, metric, threshold, used, limit],
  );
  if (!inserted.length) return;
  const resets = resetsAt(new Date(`${period}T00:00:00Z`)).toISOString();
  const recommendation =
    threshold === 100 || plan !== "free"
      ? null
      : await recommendFor(context, metric, usageFrom(used, limit));
  const place = await placeNames(context, context.environmentId);
  await enqueueNotification(context, {
    kind: "usage_alert",
    agentId: null,
    dedupe: `${period}:${metric}:${threshold}`,
    payload: {
      workspace: place.workspace,
      metric,
      threshold,
      plan,
      used,
      limit,
      resetsAt: resets,
      path: `${appPath(place.slug, "settings", "billing")}#billing-usage`,
      recommendation,
      expiresAt: resets,
    },
  });
}

/**
 * Called with each new count. Only a count exactly at a threshold costs any
 * query, and whatever happens here stays here: a savepoint undoes a failed
 * alert, and the action or step that was counted goes ahead regardless.
 */
export async function noteUsage(
  context: RuntimeContext,
  crossing: Omit<Crossing, "threshold">,
) {
  const threshold = crossedAt(crossing.used, crossing.limit);
  if (!threshold) return;
  const { manager } = context;
  await manager.query("SAVEPOINT usage_alert");
  try {
    await recordCrossing(context, { ...crossing, threshold });
    await manager.query("RELEASE SAVEPOINT usage_alert");
    queued.add(context);
  } catch (error) {
    console.error("Usage alert failed", describeError(error));
    await manager.query("ROLLBACK TO SAVEPOINT usage_alert");
  }
}

const queued = new WeakSet<RuntimeContext>();

/** Whether this call met a threshold, so its email can go out right away. */
export const metThreshold = (context: RuntimeContext) => queued.has(context);
