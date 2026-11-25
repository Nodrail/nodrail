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
  drift: z.number(),
  unmanaged: z.record(z.string(), z.number()),
  names: z
    .object({ drift: z.array(z.string()), unmanaged: z.array(z.string()) })
    .nullable(),
  applied_revision: z.string().nullable(),
  locked_revision: z.string().nullable(),
  observed_at: z.date(),
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
              r.activation, r.in_step, r.drift, r.unmanaged, r.names,
              r.applied_revision, r.locked_revision, r.observed_at
       FROM nodrail.inventory_reports r
       JOIN nodrail.users u ON u.id = r.user_id
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
    activation: row.activation,
    inStep: row.in_step,
    drift: row.drift,
    unmanaged: row.unmanaged,
    names: row.names,
    appliedRevision: row.applied_revision,
    lockedRevision: row.locked_revision,
    observedAt: row.observed_at.toISOString(),
    stale: now - row.observed_at.getTime() > INVENTORY_STALE_MS,
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
      stale: list.filter((row) => row.stale).length,
      drifted: list.filter((row) => row.drift > 0).length,
      behind: list.filter((row) => row.behind).length,
    },
  };
}
