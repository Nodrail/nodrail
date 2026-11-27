import "server-only";
import { z } from "zod";
import { seesWholeWorkspace } from "@/contracts/v1/access";
import {
  INVENTORY_STALE_MS,
  type InventoryDto,
  type InventoryRowDto,
} from "@/contracts/v1/inventory";
import {
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";
import { disconnectedInstallation } from "@/server/modules/agents/installation-view";
import { intendedRevisions } from "./revisions";

/** Behind when the team published a revision and this one was applied from another. */
const behind = (intended: string | null, applied: string | null) => ({
  intendedRevision: intended,
  behind: intended !== null && applied !== intended,
});

const reportRow = z.object({
  user_id: z.uuid(),
  display_name: z.string(),
  machine: z.string(),
  project: z.string(),
  project_id: z.string().nullable(),
  host: z.string(),
  agent: z.string().nullable(),
  activation: z.enum(["verified", "configured", "inactive", "unknown"]),
  in_step: z.boolean(),
  disconnected: z.boolean(),
  drift: z.number(),
  unmanaged: z.record(z.string(), z.number()),
  names: z
    .object({ drift: z.array(z.string()), unmanaged: z.array(z.string()) })
    .nullable(),
  applied_revision: z.string().nullable(),
  locked_revision: z.string().nullable(),
  observed_at: z.date(),
  last_seen_at: z.date(),
});

/** Fresh reports by what they say about the hook. */
const activationCounts = (rows: InventoryRowDto[]) => ({
  verified: rows.filter((row) => row.activation === "verified").length,
  configured: rows.filter((row) => row.activation === "configured").length,
  inactive: rows.filter((row) => row.activation === "inactive").length,
  unknown: rows.filter((row) => row.activation === "unknown").length,
});

/**
 * The environment's inventory. Admins and policy managers see everyone's
 * machines; anyone else only their own, since a report says which tools a
 * person uses.
 */
export async function listInventory(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<InventoryDto> {
  requireCapability(context, "workspace:read");
  const environment = await findEnvironment(context, environmentSlug);
  const seesEveryone = seesWholeWorkspace(context.role);
  const rows = parseRows(
    reportRow,
    await context.manager.query(
      `SELECT r.user_id, u.display_name, r.machine, r.project, r.project_id, r.host, r.agent,
              r.activation, r.in_step, (${disconnectedInstallation}) AS disconnected,
              r.drift, r.unmanaged, r.names,
              r.applied_revision, r.locked_revision, r.observed_at, greatest(r.observed_at, r.last_seen_at) AS last_seen_at
       FROM nodrail.inventory_reports r
       JOIN nodrail.users u ON u.id = r.user_id
       LEFT JOIN nodrail.installations i ON i.workspace_id = r.workspace_id
         AND i.environment_id = r.environment_id AND i.enrollment_project_id = r.project_id
         AND i.enrollment_machine_id = r.machine::uuid
       WHERE r.workspace_id = $1 AND r.environment_id = $2 AND ($3 OR r.user_id = $4)
       ORDER BY r.project, u.display_name, r.machine, r.host
       LIMIT 1000`,
      [
        context.workspaceId,
        environment.id,
        seesEveryone,
        context.principal.userId,
      ],
    ),
  );
  const intended = await intendedRevisions(context, environment.id);
  const now = Date.now();
  const list: InventoryRowDto[] = rows.map((row) => ({
    person: row.display_name,
    mine: row.user_id === context.principal.userId,
    machine: row.machine.slice(0, 8),
    project: row.project,
    projectBound: row.project_id !== null,
    host: row.host,
    agent: row.agent,
    activation: row.disconnected ? "disconnected" : row.activation,
    inStep: !row.disconnected && row.in_step,
    drift: row.drift,
    unmanaged: row.unmanaged,
    names: row.names,
    appliedRevision: row.applied_revision,
    lockedRevision: row.locked_revision,
    observedAt: row.observed_at.toISOString(),
    stale: now - row.last_seen_at.getTime() > INVENTORY_STALE_MS,
    ...behind(
      // An unbound report is never compared with anyone's intended revision.
      (row.project_id && intended.get(row.project_id)?.revision) ?? null,
      row.applied_revision,
    ),
  }));
  return {
    rows: list,
    seesEveryone,
    summary: {
      reports: list.length,
      ...activationCounts(list.filter((row) => !row.stale)),
      disconnected: list.filter((row) => row.activation === "disconnected")
        .length,
      stale: list.filter(
        (row) => row.stale && row.activation !== "disconnected",
      ).length,
      drifted: list.filter((row) => row.drift > 0).length,
      behind: list.filter((row) => row.behind).length,
    },
  };
}
