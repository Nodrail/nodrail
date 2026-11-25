import "server-only";
import type { EntityManager } from "typeorm";
import { z } from "zod";
import {
  guidanceMark,
  type FirstStepsDto,
  type GuidanceDto,
  type GuidanceMark,
} from "@/contracts/v1/guidance";
import {
  parseInput,
  parseRows,
  type UserContext,
  type WorkspaceContext,
} from "@/server/db/context";
import { findEnvironment } from "@/server/modules/workspaces";

/*
 * In-product guidance. What a person has seen is theirs alone: row level
 * security limits every read and write to their own rows, whichever
 * workspace is open, so these queries only ever name the person for speed.
 */

const guidanceRow = z.object({ key: z.string(), value: z.string().nullable() });

/** Everything this person has seen, by key. */
export async function readGuidance(context: {
  manager: EntityManager;
}): Promise<GuidanceDto> {
  const rows = parseRows(
    guidanceRow,
    await context.manager.query(
      `SELECT key, value FROM nodrail.user_guidance
       WHERE user_id = nodrail.current_user_id()`,
    ),
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * Records that this person has seen something. Marking again changes nothing,
 * unless the key keeps a value and it moved on (the last entry read).
 */
export async function markGuidance(
  context: UserContext,
  input: GuidanceMark,
): Promise<void> {
  const { key, value } = parseInput(guidanceMark, input);
  await context.manager.query(
    `INSERT INTO nodrail.user_guidance (user_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE
       SET value = EXCLUDED.value, seen_at = clock_timestamp()
       WHERE nodrail.user_guidance.value IS DISTINCT FROM EXCLUDED.value`,
    [context.principal.userId, key, value],
  );
}

const stepsRow = z.object({
  agent: z.boolean(),
  rule: z.boolean(),
  decision: z.boolean(),
  teammate: z.boolean(),
});

/**
 * A new workspace's first steps, each from what is really there: an agent
 * connected and a rule live in this environment, a call here the rules
 * decided, and someone else in the workspace or invited to it.
 */
export async function getFirstSteps(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<FirstStepsDto> {
  const environment = await findEnvironment(context, environmentSlug);
  const [steps] = parseRows(
    stepsRow,
    await context.manager.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM nodrail.installations i
           JOIN nodrail.agents a
             ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
           WHERE i.workspace_id = $1 AND i.environment_id = $2
             AND i.archived_at IS NULL AND a.archived_at IS NULL) AS agent,
         EXISTS (
           SELECT 1 FROM nodrail.policy_rules r
           JOIN nodrail.active_policies p
             ON p.workspace_id = r.workspace_id
            AND p.policy_version_id = r.policy_version_id
           WHERE r.workspace_id = $1 AND p.environment_id = $2
             AND (r.expires_at IS NULL OR r.expires_at > clock_timestamp())) AS rule,
         EXISTS (
           SELECT 1 FROM nodrail.action_requests ar
           WHERE ar.workspace_id = $1 AND ar.environment_id = $2) AS decision,
         (EXISTS (
            SELECT 1 FROM nodrail.workspace_memberships m
            WHERE m.workspace_id = $1 AND m.user_id <> $3)
          OR EXISTS (
            SELECT 1 FROM nodrail.workspace_invites v
            WHERE v.workspace_id = $1)) AS teammate`,
      [context.workspaceId, environment.id, context.principal.userId],
    ),
  );
  return (
    steps ?? { agent: false, rule: false, decision: false, teammate: false }
  );
}
