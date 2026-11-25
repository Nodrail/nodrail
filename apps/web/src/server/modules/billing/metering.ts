import "server-only";
import { usageFrom, type PlanKey } from "@/contracts/v1/billing";
import { resetsAt, type UsageNoticeDto } from "@/contracts/v1/usage-alerts";
import { AppError, type RuntimeContext } from "@/server/db/context";
import {
  deploymentMode,
  operatorLimits,
  UNLIMITED,
  type DeploymentMode,
} from "@/server/deployment";
import { noteUsage } from "./usage-alerts";
import { stripeEntitlements, type Scope } from "./stripe-entitlements";

type Counter = "intents" | "steps";
const allowance = {
  intents: "intentsPerMonth",
  steps: "stepsPerMonth",
} as const;
const metricOf = { intents: "actions", steps: "steps" } as const;

const usageWithLimit = (used: number, limit: number) =>
  limit === UNLIMITED
    ? { used, limit, state: "ok" as const }
    : usageFrom(used, limit);

/**
 * This month's agent actions and run steps against the plan, read together.
 * Every member sees these numbers on Overview.
 */
export async function getUsageNotice(scope: Scope): Promise<UsageNoticeDto> {
  const provider = commerceProvider();
  const { plan, intentsPerMonth, stepsPerMonth } =
    await provider.entitlements(scope);
  const [row]: { intents: number; steps: number; period: string }[] =
    await scope.manager.query(
      `SELECT COALESCE(u.intents, 0) AS intents, COALESCE(u.steps, 0) AS steps,
              to_char(m.period, 'YYYY-MM-DD') AS period
       FROM (SELECT ${currentMonth} AS period) m
       LEFT JOIN nodrail.billing_usage u
         ON u.workspace_id = $1 AND u.period = m.period`,
      [scope.workspaceId],
    );
  const period = row?.period ?? new Date().toISOString().slice(0, 10);
  return {
    plan,
    period: period.slice(0, 7),
    resetsAt: resetsAt(new Date(`${period}T00:00:00Z`)).toISOString(),
    actions: usageWithLimit(row?.intents ?? 0, intentsPerMonth),
    steps: usageWithLimit(row?.steps ?? 0, stepsPerMonth),
    deployment: provider.deployment,
  };
}

const currentMonth = `date_trunc('month', timezone('UTC', clock_timestamp()))::date`;

type Entitlements = {
  plan: PlanKey;
  intentsPerMonth: number;
  stepsPerMonth: number;
};

interface CommerceProvider {
  deployment: DeploymentMode;
  entitlements(scope: Scope): Promise<Entitlements>;
  recordUsage(context: RuntimeContext, counter: Counter): Promise<void>;
}

function meteredProvider(
  deployment: DeploymentMode,
  entitlements: CommerceProvider["entitlements"],
  notify?: typeof noteUsage,
): CommerceProvider {
  return {
    deployment,
    entitlements,
    async recordUsage(context, counter) {
      const { plan, ...limits } = await entitlements(context);
      const limit = limits[allowance[counter]];
      const [counted]: { used: number; period: string }[] =
        await context.manager.query(
          `INSERT INTO nodrail.billing_usage (workspace_id, period, ${counter})
       VALUES ($1, ${currentMonth}, 1)
       ON CONFLICT (workspace_id, period) DO UPDATE
       SET ${counter} = LEAST(nodrail.billing_usage.${counter}::bigint + 1, $3)
       WHERE nodrail.billing_usage.${counter} < $2 OR $2 = $3
       RETURNING ${counter} AS used, to_char(period, 'YYYY-MM-DD') AS period`,
          [context.workspaceId, limit, UNLIMITED],
        );
      if (!counted) throw new AppError("QUOTA_EXCEEDED");
      if (notify)
        await notify(context, {
          ...counted,
          metric: metricOf[counter],
          plan,
          limit,
        });
    },
  };
}

const stripe = meteredProvider("cloud", stripeEntitlements, noteUsage);
const selfHosted = meteredProvider("self-hosted", async () => ({
  plan: "free",
  ...operatorLimits(),
}));

const commerceProvider = () =>
  deploymentMode() === "cloud" ? stripe : selfHosted;

/**
 * Counts one new logical call, or refuses it. Billing can only ever stop a call
 * from starting: nothing here can turn a deny into an allow.
 */
export const consumeIntent = (context: RuntimeContext) =>
  commerceProvider().recordUsage(context, "intents");

/**
 * Counts a step recorded for the first time, or refuses it. Steps are free;
 * the allowance bounds storage. A refused step is not recorded, so gates
 * waiting for it stay closed.
 */
export const consumeStep = (context: RuntimeContext) =>
  commerceProvider().recordUsage(context, "steps");
