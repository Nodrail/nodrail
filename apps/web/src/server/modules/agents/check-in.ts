import "server-only";
import { z } from "zod";
import type { CheckInDto } from "@/contracts/v1/agents";
import {
  AppError,
  parseRows,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";

const checkInRow = z.object({
  last_seen_at: z.date().nullable(),
  allowed: z.boolean(),
  blocked: z.boolean(),
  denied: z.boolean(),
});

/**
 * Whether a newly connected agent has checked in here, and which of the
 * setup checks its own decisions already show: an action a rule allowed, an
 * action no rule covered that stayed blocked, and one a rule denied. Read as
 * the person's screens are, so it says nothing about agents they can't see.
 */
export async function getCheckIn(
  context: WorkspaceContext,
  environmentSlug: string,
  agentKey: string,
): Promise<CheckInDto> {
  const environment = await findEnvironment(context, environmentSlug);
  const [row] = parseRows(
    checkInRow,
    await context.manager.query(
      `SELECT i.last_seen_at,
              EXISTS (SELECT 1 FROM nodrail.audit_events e
                      WHERE e.workspace_id = a.workspace_id AND e.agent_id = a.id
                        AND e.environment_id = i.environment_id
                        AND e.decision_code = 'allowed_by_rule') AS allowed,
              EXISTS (SELECT 1 FROM nodrail.audit_events e
                      WHERE e.workspace_id = a.workspace_id AND e.agent_id = a.id
                        AND e.environment_id = i.environment_id
                        AND e.decision_code = 'denied_no_rule') AS blocked,
              EXISTS (SELECT 1 FROM nodrail.audit_events e
                      WHERE e.workspace_id = a.workspace_id AND e.agent_id = a.id
                        AND e.environment_id = i.environment_id
                        AND e.decision_code = 'denied_by_rule') AS denied
       FROM nodrail.agents a
       JOIN nodrail.installations i
         ON i.workspace_id = a.workspace_id AND i.agent_id = a.id
       WHERE a.workspace_id = $1 AND i.environment_id = $2
         AND a.external_key = $3
         AND a.archived_at IS NULL AND i.archived_at IS NULL
       LIMIT 1`,
      [context.workspaceId, environment.id, agentKey],
    ),
  );
  if (!row) throw new AppError("NOT_FOUND");
  return {
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    checks: { allowed: row.allowed, blocked: row.blocked, denied: row.denied },
  };
}
