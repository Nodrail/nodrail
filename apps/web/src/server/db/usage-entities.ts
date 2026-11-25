import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryColumn,
  type Relation,
} from "typeorm";
import {
  Clock,
  Fk,
  Int,
  OptionalText,
  OptionalTime,
  Text,
  Time,
  inWorkspace,
  schema,
} from "./columns";
import { Installation, Workspace } from "./entities";

/** Billing state and the counters that limit use: plan, usage, rate, alerts. */

/** What Stripe last told us. Absent means the free plan. */
@Entity({ schema, name: "workspace_billing" })
@Index("workspace_billing_customer", ["stripeCustomerId"], {
  unique: true,
  where: `"stripe_customer_id" IS NOT NULL`,
})
@Check("workspace_billing_plan", `"plan" IN ('free', 'pro')`)
export class WorkspaceBilling {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @Text({ default: "free" }) plan!: string;
  @Text({ default: "none" }) status!: string;
  @OptionalText() stripeCustomerId!: string | null;
  @OptionalText() stripeSubscriptionId!: string | null;
  @OptionalText() openCheckoutId!: string | null;
  @OptionalTime() currentPeriodEnd!: Date | null;
  @Column({ type: "boolean", default: false }) cancelAtPeriodEnd!: boolean;
  @OptionalTime() pastDueSince!: Date | null;
  @Clock() updatedAt!: Date;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
}

/** Logical calls and new run steps per UTC month; never retries or check-ins. */
@Entity({ schema, name: "billing_usage" })
@Check("billing_usage_intents", `"intents" >= 0`)
@Check("billing_usage_steps", `"steps" >= 0`)
export class BillingUsage {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "date" }) period!: string;
  @Int({ default: 0 }) intents!: number;
  @Int({ default: 0 }) steps!: number;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
}

/** One row per installation: the current minute and how many calls it made. */
@Entity({ schema, name: "runtime_rate_windows" })
export class RuntimeRateWindow {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) installationId!: string;
  @Time() windowStart!: Date;
  @Int() calls!: number;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
}

/**
 * A monthly allowance threshold a workspace reached, once per UTC month,
 * metric and threshold: the key is what keeps its email from repeating.
 */
@Entity({ schema, name: "usage_alerts" })
@Check("usage_alerts_metric", `"metric" IN ('actions', 'steps')`)
@Check("usage_alerts_threshold", `"threshold" IN (80, 100)`)
export class UsageAlert {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "date" }) period!: string;
  @PrimaryColumn({ type: "text" }) metric!: "actions" | "steps";
  @PrimaryColumn({ type: "smallint" }) threshold!: 80 | 100;
  /** The count that met it, and the allowance it was a share of. */
  @Int() used!: number;
  @Int() allowance!: number;
  @Clock() notifiedAt!: Date;
  @Fk(() => Workspace, { workspace_id: "id" }) workspace!: Relation<Workspace>;
}
