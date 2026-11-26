import {
  Check,
  Column,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  type Relation,
} from "typeorm";
import {
  Clock,
  Fk,
  Id,
  Json,
  OptionalText,
  OptionalTime,
  OptionalUuid,
  Text,
  Time,
  Uuid,
  inWorkspace,
  member,
  schema,
} from "./columns";
import {
  ActionRequest,
  DecisionPermit,
  Environment,
  Installation,
  WorkspaceMembership,
} from "./entities";

/**
 * Numeric budgets in Cloud. A window is where one
 * budget counts: a run, a step, a day in its time zone, or the environment.
 * Its row is what a permit locks, in key order, before it adds a call, so
 * two calls never both take the last slot. Totals are summed from the
 * reservations under that lock; nothing is kept twice.
 */

/** Whole minor units, read back as text so nothing is rounded on the way. */
const Amount = () => Column({ type: "bigint", nullable: true });

const budgetKey = `"budget_key" ~ '^[a-z0-9][a-z0-9_-]{0,62}$'`;

@Entity({ schema, name: "budget_windows" })
@Unique("budget_windows_key", [
  "workspaceId",
  "environmentId",
  "budgetKey",
  "windowKey",
])
@Unique(["workspaceId", "id"])
@Check("budget_windows_budget", budgetKey)
@Check(
  "budget_windows_window",
  `length("window_key") BETWEEN 1 AND 300 AND "per" IN ('step', 'run', 'day') AND "across" IN ('run', 'environment') AND ("per" = 'day') = ("day" IS NOT NULL) AND ("day" IS NULL) = ("timezone" IS NULL) AND ("day" IS NULL) = ("starts_at" IS NULL) AND ("starts_at" IS NULL) = ("ends_at" IS NULL) AND ("starts_at" IS NULL OR "ends_at" > "starts_at")`,
)
@Check(
  "budget_windows_scope",
  `("across" = 'run') = ("run_id" IS NOT NULL) AND ("per" = 'step') = ("step_key" IS NOT NULL) AND ("run_key" IS NULL OR length("run_key") BETWEEN 1 AND 200) AND length("step_key") <= 200 AND "unit" ~ '^[a-z][a-z0-9_]{0,31}$'`,
)
export class BudgetWindow {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  /** The budget's logical id in the policy, stable across versions. */
  @Text() budgetKey!: string;
  /** Which window of it: built from the run, step and day it counts. */
  @Text() windowKey!: string;
  @Text() per!: "step" | "run" | "day";
  @Text() across!: "run" | "environment";
  /** The run counted, kept when the run itself is retired: no foreign key. */
  @OptionalUuid() runId!: string | null;
  @OptionalText() runKey!: string | null;
  /** The step counted; empty for actions outside any step. */
  @OptionalText() stepKey!: string | null;
  /** The local date of a day window, `YYYY-MM-DD`. */
  @OptionalText() day!: string | null;
  @OptionalText() timezone!: string | null;
  @OptionalTime() startsAt!: Date | null;
  @OptionalTime() endsAt!: Date | null;
  @Text() unit!: string;
  @Clock() createdAt!: Date;
  /** Set by each permit that counts here; writing it is the window's lock. */
  @Clock() touchedAt!: Date;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
}

/** One host call's admission response, replayed by installation and fingerprint. */
@Entity({ schema, name: "budget_leases" })
@Unique("budget_leases_key", ["workspaceId", "installationId", "callKey"])
@Unique("budget_leases_workspace_id", ["workspaceId", "id"])
export class BudgetLease {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() installationId!: string;
  @Text() callKey!: string;
  @Text() bodyDigest!: string;
  @Text() policyDigest!: string;
  @OptionalUuid() claimId!: string | null;
  @OptionalUuid() agentId!: string | null;
  @Json("{}") response!: object;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
}

/**
 * One call's share of one budget, set aside when its permit was issued and
 * settled by its report (`runtime`) or, when that left it unknown, by an
 * admin or policy manager (`person`). Only a known failure releases.
 */
@Entity({ schema, name: "budget_reservations" })
@Unique("budget_reservations_once", [
  "workspaceId",
  "actionRequestId",
  "budgetKey",
])
@Unique("budget_reservations_lease_once", [
  "workspaceId",
  "leaseId",
  "budgetKey",
])
@Check(
  "budget_reservations_origin",
  `("lease_id" IS NULL AND "permit_id" IS NOT NULL AND "action_request_id" IS NOT NULL) OR ("lease_id" IS NOT NULL AND "permit_id" IS NULL)`,
)
@Index("budget_reservations_window", ["workspaceId", "windowId", "state"])
@Index("budget_reservations_open", [
  "workspaceId",
  "environmentId",
  "state",
  "createdAt",
])
@Check("budget_reservations_budget", budgetKey)
@Check(
  "budget_reservations_state",
  `"state" IN ('reserved', 'consumed', 'released', 'unknown') AND ("state" = 'reserved') = ("settled_by" IS NULL) AND ("settled_by" IS NULL) = ("settled_at" IS NULL) AND ("settled_by" IS NULL OR "settled_by" IN ('runtime', 'person')) AND ("settled_by" = 'person') = ("reconciled_by" IS NOT NULL) AND ("settled_by" = 'person') = ("note" IS NOT NULL) AND length("note") BETWEEN 1 AND 500`,
)
@Check(
  "budget_reservations_amounts",
  `"source" IN ('admission', 'measured') AND ("source" = 'admission') = ("amount" IS NOT NULL) AND ("source" = 'measured') = ("measured_path" IS NOT NULL) AND ("amount" IS NULL OR "amount" >= 0) AND ("measured" IS NULL OR ("measured" >= 0 AND "source" = 'measured' AND "state" = 'consumed')) AND ("measured_path" IS NULL OR "measured_path" ~ '^(tokens|result(\\.[a-z][a-z0-9_]{0,62}){1,4})$') AND "unit" ~ '^[a-z][a-z0-9_]{0,31}$' AND "unknown_after" > "created_at"`,
)
export class BudgetReservation {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @OptionalUuid() actionRequestId!: string | null;
  @OptionalUuid() permitId!: string | null;
  @OptionalUuid() leaseId!: string | null;
  @Uuid() windowId!: string;
  @Text() budgetKey!: string;
  @Text() source!: "admission" | "measured";
  @Text() unit!: string;
  /** What an admission budget set aside before the call. */
  @Amount() amount!: string | null;
  /** The result path a measured budget reads, or `tokens`. */
  @OptionalText() measuredPath!: string | null;
  /** What the report measured for it; null is no reading, never zero. */
  @Amount() measured!: string | null;
  @Text({ default: "reserved" }) state!:
    "reserved" | "consumed" | "released" | "unknown";
  @OptionalText() settledBy!: "runtime" | "person" | null;
  @OptionalTime() settledAt!: Date | null;
  @OptionalUuid() reconciledBy!: string | null;
  @OptionalText() note!: string | null;
  @Clock() createdAt!: Date;
  /** Host lease expiry, or when a missing permit report is shown as unknown. */
  @Time() unknownAfter!: Date;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => ActionRequest, inWorkspace("action_request_id"), { nullable: true })
  actionRequest!: Relation<ActionRequest> | null;
  @Fk(
    () => DecisionPermit,
    {
      workspace_id: "workspaceId",
      permit_id: "id",
      action_request_id: "actionRequestId",
    },
    { nullable: true },
  )
  permit!: Relation<DecisionPermit> | null;
  @OptionalTime() startedAt!: Date | null;
  @Fk(() => BudgetLease, inWorkspace("lease_id"), { nullable: true })
  lease!: Relation<BudgetLease> | null;
  @Fk(() => BudgetWindow, inWorkspace("window_id"))
  window!: Relation<BudgetWindow>;
  @Fk(() => WorkspaceMembership, member("reconciled_by"), { nullable: true })
  reconciler!: Relation<WorkspaceMembership> | null;
}

/**
 * The work revision an installation sent with an action (`submit`) and again
 * with its permit (`permit`), for gates on `subject: revision`. A null
 * revision means the host could not read it. Added once, never changed.
 */
@Entity({ schema, name: "action_subjects" })
@Check("action_subjects_stage", `"stage" IN ('submit', 'permit')`)
@Check(
  "action_subjects_revision",
  `"revision" IS NULL OR "revision" ~ '^[0-9a-f]{64}$'`,
)
export class ActionSubject {
  @PrimaryColumn({ type: "uuid" }) workspaceId!: string;
  @PrimaryColumn({ type: "uuid" }) actionRequestId!: string;
  @PrimaryColumn({ type: "text" }) stage!: "submit" | "permit";
  /** The `sha256:` digest's hex. */
  @OptionalText() revision!: string | null;
  @Clock() recordedAt!: Date;
  @Fk(() => ActionRequest, inWorkspace("action_request_id"))
  actionRequest!: Relation<ActionRequest>;
}
