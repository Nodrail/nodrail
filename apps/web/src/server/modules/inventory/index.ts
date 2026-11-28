import "server-only";
import type { ReceivedSpans } from "@nodrail/sdk";
import {
  UNMANAGED_PREFIX,
  observationAttributes,
  unmanagedKind,
} from "@/contracts/v1/inventory";
import type { RuntimeContext } from "@/server/db/context";

/**
 * The team's inventory (W4): what each person's machines report about each
 * project on each host, from the `nodrail.observation` spans `nodrail
 * observe` sends. A report is always its token's person's own. Ingestion
 * of every reported kind is in the reporting module.
 */

const MAX_PROJECT = 200;
/** A span's time is at most this far ahead of the server's clock. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export type ReportedProject = { name: string; id: string | null };

export type Report = {
  machine: string;
  project: ReportedProject;
  host: string;
  agent: string | null;
  activation: string;
  inStep: boolean;
  drift: number;
  appliedRevision: string | null;
  lockedRevision: string | null;
  unmanaged: Record<string, number>;
  names: { drift: string[]; unmanaged: string[] } | null;
  observedAt: Date;
};

function unmanagedCounts(attributes: Record<string, string>) {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!key.startsWith(UNMANAGED_PREFIX) || key.endsWith(".names")) continue;
    const kind = key.slice(UNMANAGED_PREFIX.length);
    const number = Number(value);
    if (!unmanagedKind.test(kind) || !/^\d{1,6}$/.test(value)) return null;
    counts[kind] = number;
  }
  return Object.keys(counts).length > 20 ? null : counts;
}

/** When the span says it happened, in ms, if it's a time that can be. */
export function observedTime(
  span: ReceivedSpans["spans"][number],
  now: number,
) {
  if (!/^\d{1,20}$/.test(span.end)) return null;
  const at = Number(BigInt(span.end) / 1_000_000n);
  return at > 0 && at <= now + MAX_CLOCK_SKEW_MS ? at : null;
}

/** One span as a report, or null when it isn't a well-formed observation. */
export function toReport(
  project: ReportedProject,
  span: ReceivedSpans["spans"][number],
  now: number,
): Report | null {
  if (span.name !== "nodrail.observation") return null;
  if (project.name.length > MAX_PROJECT) return null;
  const parsed = observationAttributes.safeParse(span.attributes);
  const unmanaged = unmanagedCounts(span.attributes);
  const observedAt = observedTime(span, now);
  if (!parsed.success || !unmanaged || observedAt === null) return null;
  const a = parsed.data;
  const named =
    a["nodrail.drift.names"] !== undefined ||
    a["nodrail.unmanaged.names"] !== undefined;
  return {
    machine: a["nodrail.machine"],
    project,
    host: a["nodrail.host"],
    agent: a["nodrail.agent"] ?? null,
    activation: a["nodrail.activation"],
    inStep: a["nodrail.in_step"],
    drift: a["nodrail.drift"],
    appliedRevision: a["nodrail.workspace.revision"] ?? null,
    lockedRevision: a["nodrail.workspace.locked"] ?? null,
    unmanaged,
    names: named
      ? {
          drift: a["nodrail.drift.names"] ?? [],
          unmanaged: a["nodrail.unmanaged.names"] ?? [],
        }
      : null,
    observedAt: new Date(observedAt),
  };
}

/** Keeps the report unless the one already kept is newer. */
export async function keepObservation(
  context: Pick<RuntimeContext, "workspaceId" | "manager">,
  owner: { environmentId: string; userId: string },
  report: Report,
) {
  const { environmentId, userId } = owner;
  const update = `DO UPDATE SET
       agent = excluded.agent, activation = excluded.activation,
       in_step = excluded.in_step, drift = excluded.drift,
       applied_revision = excluded.applied_revision,
       locked_revision = excluded.locked_revision,
       unmanaged = excluded.unmanaged, names = excluded.names,
       observed_at = excluded.observed_at, received_at = clock_timestamp(),
       project = excluded.project
     WHERE r.observed_at < excluded.observed_at`;
  await context.manager.query(
    `INSERT INTO nodrail.inventory_reports AS r
       (workspace_id, environment_id, user_id, machine, project, host, agent,
        activation, in_step, drift, applied_revision, locked_revision,
        unmanaged, names, observed_at, project_id, project_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17)
     ON CONFLICT ON CONSTRAINT inventory_reports_latest ${update}`,
    [
      context.workspaceId,
      environmentId,
      userId,
      report.machine,
      report.project.name,
      report.host,
      report.agent,
      report.activation,
      report.inStep,
      report.drift,
      report.appliedRevision,
      report.lockedRevision,
      JSON.stringify(report.unmanaged),
      report.names === null ? null : JSON.stringify(report.names),
      report.observedAt,
      report.project.id,
      // The id, or the name visibly unbound: never two projects by one name.
      report.project.id ?? `unbound:${report.project.name}`,
    ],
  );
}

export { listInventory } from "./list";
export { getIntendedRevision, publishIntendedRevision } from "./revisions";
