import "server-only";
import {
  effectivePlan,
  plans,
  type PlanKey,
  type SubscriptionRecord,
} from "@/contracts/v1/billing";
import type { WorkspaceContext } from "@/server/db/context";

export type Scope = Pick<WorkspaceContext, "manager" | "workspaceId">;

type BillingRow = {
  plan: string;
  status: string;
  past_due_since: Date | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  open_checkout_id: string | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};

export async function readBilling({ manager, workspaceId }: Scope, lock = "") {
  const [row]: BillingRow[] = await manager.query(
    `SELECT plan, status, past_due_since, stripe_customer_id,
            stripe_subscription_id, open_checkout_id, current_period_end,
            cancel_at_period_end
     FROM nodrail.workspace_billing WHERE workspace_id = $1 ${lock}`,
    [workspaceId],
  );
  return row;
}

const toRecord = (row: BillingRow | undefined): SubscriptionRecord | null =>
  row
    ? { plan: row.plan, status: row.status, pastDueSince: row.past_due_since }
    : null;

export const planOf = (row: BillingRow | undefined): PlanKey =>
  effectivePlan(toRecord(row), new Date());

export async function stripeEntitlements(scope: Scope) {
  const plan = planOf(await readBilling(scope));
  return { plan, ...plans[plan] };
}
