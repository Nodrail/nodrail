import { Check, Entity, PrimaryColumn } from "typeorm";
import { Int, OptionalText, OptionalTime, schema } from "./columns";

/**
 * When each scheduled job last ran, succeeded and failed, so an operator
 * can see that delivery and retention happen (readiness). One row per job;
 * no workspace data, and the error is a code, never a message with data.
 */
@Entity({ schema, name: "scheduled_runs" })
@Check("scheduled_runs_job", `"job" ~ '^[a-z][a-z0-9-]{0,39}$'`)
@Check("scheduled_runs_error", `length("last_error") <= 100`)
export class ScheduledRun {
  @PrimaryColumn({ type: "text" }) job!: string;
  @OptionalTime() lastStartedAt!: Date | null;
  @OptionalTime() lastSucceededAt!: Date | null;
  @OptionalTime() lastFailedAt!: Date | null;
  @OptionalText() lastError!: string | null;
  @Int({ default: 0 }) runs!: number;
}
