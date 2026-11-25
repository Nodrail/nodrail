import "server-only";
import { requireCapability, type WorkspaceContext } from "@/server/db/context";

const LIMIT = 5000;

/** Everything a customer put in or caused, and no credential or token digest. */
export async function exportWorkspace(context: WorkspaceContext) {
  requireCapability(context, "workspace:settings");
  const { manager, workspaceId } = context;
  const rows = (sql: string) => manager.query(sql, [workspaceId]);
  const [workspace]: unknown[] = await manager.query(
    `SELECT name, slug, created_at FROM nodrail.workspaces WHERE id = $1`,
    [workspaceId],
  );
  return {
    format: "nodrail-workspace-export/1",
    exportedAt: new Date().toISOString(),
    workspace,
    members: await rows(
      `SELECT u.display_name, u.verified_email, m.role, m.is_owner, m.status,
              m.created_at, m.revoked_at
       FROM nodrail.workspace_memberships m
       JOIN nodrail.users u ON u.id = m.user_id
       WHERE m.workspace_id = $1`,
    ),
    agents: await rows(
      `SELECT external_key, description, access_status, created_at, archived_at
       FROM nodrail.agents WHERE workspace_id = $1 ORDER BY created_at`,
    ),
    installations: await rows(
      `SELECT i.name, a.external_key AS agent, e.slug AS environment,
              i.adapter_key, i.adapter_version, i.last_seen_at, i.created_at
       FROM nodrail.installations i
       JOIN nodrail.agents a ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
       JOIN nodrail.environments e
         ON e.workspace_id = i.workspace_id AND e.id = i.environment_id
       WHERE i.workspace_id = $1`,
    ),
    activeRules: await rows(
      `SELECT r.name, e.slug AS environment, r.effect, r.tool_key, r.operation_key,
              r.resource_scope, r.conditions, r.expires_at, r.updated_at
       FROM nodrail.policy_rules r
       JOIN nodrail.active_policies p
         ON p.workspace_id = r.workspace_id AND p.policy_version_id = r.policy_version_id
       JOIN nodrail.environments e
         ON e.workspace_id = r.workspace_id AND e.id = r.environment_id
       WHERE r.workspace_id = $1`,
    ),
    actions: await rows(
      `SELECT id, tool_key, operation_key, resource_kind, resource_id, params_safe,
              initial_evaluation, attempt_count, created_at
       FROM nodrail.action_requests WHERE workspace_id = $1
       ORDER BY created_at DESC LIMIT ${LIMIT}`,
    ),
    clientReports: await rows(
      `SELECT action_request_id, outcome, details_safe, received_at
       FROM nodrail.client_reports WHERE workspace_id = $1
       ORDER BY received_at DESC LIMIT ${LIMIT}`,
    ),
    activity: await rows(
      `SELECT occurred_at, event_type, decision_code, actor_kind, payload_safe
       FROM nodrail.audit_events WHERE workspace_id = $1
       ORDER BY occurred_at DESC LIMIT ${LIMIT}`,
    ),
  };
}
