import { Check, Column, Entity, Index, Unique } from "typeorm";
import { Id, OptionalText, Text, Time, Uuid, schema } from "./columns";
import { ReportedByPerson } from "./reported-base";

/**
 * What an installation reported its local hook did (reporting contract v2):
 * a decision, or a step or action of a local run. Evidence, kept apart from
 * Cloud action state: `source` is always `local`, and nothing
 * that authorizes or passes a gate reads this table. Each event
 * once: a retry with the same span is ignored.
 */
@Entity({ schema, name: "reported_events" })
@Unique("reported_events_once", ["workspaceId", "traceId", "spanId"])
@Index("reported_events_by_time", [
  "workspaceId",
  "environmentId",
  "occurredAt",
])
@Index("reported_events_by_run", ["workspaceId", "environmentId", "run"])
@Check("reported_events_source", `"source" = 'local'`)
@Check("reported_events_kind", `"kind" IN ('decision', 'run.event')`)
@Check(
  "reported_events_ids",
  `"trace_id" ~ '^[0-9a-f]{32}$' AND "span_id" ~ '^[0-9a-f]{16}$'`,
)
@Check(
  "reported_events_machine",
  `"machine" IS NULL OR "machine" ~ '^[0-9a-f]{32}$'`,
)
@Check("reported_events_project", `length("project") BETWEEN 1 AND 200`)
@Check("reported_events_host", `"host" ~ '^[a-z][a-z0-9-]{0,39}$'`)
@Check(
  "reported_events_decision",
  `("kind" = 'decision') = ("decision" IS NOT NULL) AND ("decision" IS NULL OR "decision" IN ('allow', 'deny', 'would_deny'))`,
)
@Check(
  "reported_events_run_event",
  `("kind" = 'run.event') = ("run_event" IS NOT NULL AND "run" IS NOT NULL) AND ("run_event" IS NULL OR "run_event" IN ('step.started', 'step.finished', 'action'))`,
)
@Check("reported_events_details", `length("details"::text) <= 4000`)
export class ReportedEvent extends ReportedByPerson {
  @Id() id!: string;
  @Uuid() workspaceId!: string;
  @Uuid() environmentId!: string;
  /** Who reported it: the reporting token's person. */
  @Uuid() userId!: string;
  @Text({ default: "local" }) source!: "local";
  @Text() kind!: "decision" | "run.event";
  @Text() traceId!: string;
  @Text() spanId!: string;
  /** The machine's random id, as the installation said; not attestation. */
  @OptionalText() machine!: string | null;
  /** The project's stable id; null for a schema 1 report, shown unbound. */
  @Column({ type: "uuid", nullable: true }) projectId!: string | null;
  @Text() project!: string;
  @Text() host!: string;
  @OptionalText() agent!: string | null;
  @OptionalText() decision!: string | null;
  @OptionalText() runEvent!: string | null;
  /** The run's hashed key, when there is one. */
  @OptionalText() run!: string | null;
  @OptionalText() step!: string | null;
  @OptionalText() tool!: string | null;
  @OptionalText() operation!: string | null;
  @OptionalText() policyRevision!: string | null;
  /** The rest, allow-listed and bounded: rule, match, verdict, counts. */
  @Column({ type: "jsonb", default: () => "'{}'" })
  details!: Record<string, string | number | boolean>;
  /** When it happened, as reported. */
  @Time() occurredAt!: Date;
}
