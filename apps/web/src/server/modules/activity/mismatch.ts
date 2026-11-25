import "server-only";
import { activityCatalog } from "@/contracts/v1/activity";

/** Every recorded decision that let an action go ahead. */
const allowCodes = Object.entries(activityCatalog)
  .filter(
    ([, entry]) => entry.group === "decision" && entry.outcome === "allowed",
  )
  .map(([code]) => `'${code}'`)
  .join(", ");

/**
 * Whether the integration reported that an action ran (it succeeded or
 * failed) although Nodrail never recorded a decision allowing it: no rule
 * allowed it and no permit was issued. That is
 * the strongest sign the action went around Nodrail. "Unknown" reports claim
 * nothing, so they never count. `action` and `workspace` are SQL expressions;
 * false when there is no action.
 */
export const reportMismatch = (action: string, workspace: string) => `
  COALESCE(
    EXISTS (
      SELECT 1 FROM nodrail.client_reports mc
      WHERE mc.workspace_id = ${workspace} AND mc.action_request_id = ${action}
        AND mc.outcome IN ('success', 'failure')
    )
    AND NOT EXISTS (
      SELECT 1 FROM nodrail.audit_events me
      WHERE me.workspace_id = ${workspace} AND me.action_request_id = ${action}
        AND me.decision_code IN (${allowCodes})
    ),
    false
  )`;
