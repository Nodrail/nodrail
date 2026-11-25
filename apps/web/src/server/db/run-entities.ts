import { Check, Entity, Index, Unique, type Relation } from "typeorm";
import {
  Clock,
  Fk,
  Id,
  Json,
  OptionalSeq,
  OptionalText,
  OptionalTime,
  Text,
  Uuid,
  inWorkspace,
  keyPattern,
  schema,
} from "./columns";
import { Environment, Installation } from "./entities";

/**
 * One piece of work, named by the integration. A run belongs to the
 * installation that declared it: another installation using the same key has
 * a run of its own, and can never add to or satisfy this one.
 */
@Entity({ schema, name: "runs" })
@Unique(["workspaceId", "environmentId", "installationId", "key"])
@Unique(["workspaceId", "id"])
@Index("runs_recent", ["workspaceId", "environmentId", "lastActivityAt"])
@Index("runs_installation", ["workspaceId", "installationId"])
@Check("runs_key", `length("key") BETWEEN 1 AND 200`)
export class Run {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  @Uuid() installationId!: string;
  @Text() key!: string;
  @Clock() createdAt!: Date;
  @Clock() lastActivityAt!: Date;
  @Fk(() => Environment, inWorkspace("environment_id"))
  environment!: Relation<Environment>;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
}

/** One agent's work in a run, as its installation reported it. */
@Entity({ schema, name: "run_steps" })
@Unique(["workspaceId", "runId", "stepKey"])
@Index("run_steps_installation", ["workspaceId", "installationId"])
@Check("run_steps_key", `length("step_key") BETWEEN 1 AND 200`)
@Check("run_steps_agent", `"agent" ~ ${keyPattern}`)
@Check("run_steps_verdict", `"verdict" IS NULL OR "finished_at" IS NOT NULL`)
@Check("run_steps_receipt", `pg_column_size("receipt") <= 16384`)
@Check("run_steps_started", `("started_at" IS NULL) = ("started_seq" IS NULL)`)
@Check(
  "run_steps_finished",
  `("finished_at" IS NULL) = ("finished_seq" IS NULL)`,
)
export class RunStep {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() runId!: string;
  @Text() stepKey!: string;
  @Text() agent!: string;
  @Uuid() installationId!: string;
  @OptionalTime() startedAt!: Date | null;
  @OptionalTime() finishedAt!: Date | null;
  @OptionalSeq() startedSeq!: string | null;
  @OptionalSeq() finishedSeq!: string | null;
  @OptionalText() verdict!: string | null;
  /** Findings and usage, as reported: `{ findings, usage }`. */
  @Json("{}") receipt!: object;
  @Fk(() => Run, inWorkspace("run_id")) run!: Relation<Run>;
  @Fk(() => Installation, inWorkspace("installation_id"))
  installation!: Relation<Installation>;
}
