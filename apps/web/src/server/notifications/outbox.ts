import "server-only";
import type { EntityManager } from "typeorm";
import { capabilitiesFor, roles } from "@/contracts/v1/access";
import {
  notificationAudience,
  type NotificationKind,
  type NotificationPayloads,
  type NotificationPreference,
} from "@/contracts/v1/notifications";
import { appPath } from "@/lib/product-path";

/** At most one email per person, agent and kind in this long. */
const THROTTLE_MS = 5 * 60_000;

const preferenceColumn: Record<NotificationPreference, string> = {
  integrationStale: "integration_stale",
  usageAlerts: "usage_alerts",
};

const preferenceFor: Record<NotificationKind, NotificationPreference> = {
  integration_stale: "integrationStale",
  usage_alert: "usageAlerts",
};

function rolesFor(preference: NotificationPreference) {
  const wanted = notificationAudience[preference];
  return roles.filter((role) =>
    capabilitiesFor(role, false).some((item) => wanted.includes(item)),
  );
}

type Scope = { manager: EntityManager; workspaceId: string };

/**
 * People who chose this, can act on it, and may see the agent it is about.
 * A notice about the workspace itself names no agent.
 */
async function recipients(
  { manager, workspaceId }: Scope,
  kind: NotificationKind,
  agentId: string | null,
) {
  const preference = preferenceFor[kind];
  const rows: { user_id: string; verified_email: string }[] =
    await manager.query(
      `SELECT m.user_id, u.verified_email
     FROM nodrail.workspace_memberships m
     JOIN nodrail.users u ON u.id = m.user_id
     LEFT JOIN nodrail.notification_preferences p
       ON p.workspace_id = m.workspace_id AND p.user_id = m.user_id
     WHERE m.workspace_id = $1 AND m.status = 'active' AND u.status = 'active'
       AND u.verified_email IS NOT NULL
       AND m.role = ANY($2)
       AND COALESCE(p.${preferenceColumn[preference]}, true)
       AND ($3::uuid IS NULL OR m.role IN ('admin', 'policy_manager')
            OR EXISTS (SELECT 1 FROM nodrail.agent_members am
                       WHERE am.workspace_id = m.workspace_id
                         AND am.user_id = m.user_id AND am.agent_id = $3))`,
      [workspaceId, rolesFor(preference), agentId],
    );
  return rows;
}

/**
 * Written in the transaction of the event it reports, so one cannot exist
 * without the other. Sending happens later and can never affect this.
 */
export async function enqueueNotification<Kind extends NotificationKind>(
  scope: Scope,
  notice: {
    kind: Kind;
    /** Null for a notice about the workspace, which then needs `dedupe`. */
    agentId: string | null;
    /** Identifies repeats. Defaults to the agent, within the throttle window. */
    dedupe?: string;
    payload: NotificationPayloads[Kind];
  },
) {
  const { kind, agentId, payload } = notice;
  const bucket =
    notice.dedupe ?? `${agentId}:${Math.floor(Date.now() / THROTTLE_MS)}`;
  for (const person of await recipients(scope, kind, agentId))
    await scope.manager.query(
      `INSERT INTO nodrail.notification_outbox
         (workspace_id, kind, recipient_user_id, recipient_email, payload_safe,
          dedupe_key)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (workspace_id, dedupe_key) DO NOTHING`,
      [
        scope.workspaceId,
        kind,
        person.user_id,
        person.verified_email,
        JSON.stringify(payload),
        `${kind}:${bucket}:${person.user_id}`,
      ],
    );
}

/** The names a notification needs, read once for the place it concerns. */
export async function placeNames(
  { manager, workspaceId }: Scope,
  environmentId: string,
) {
  const [row]: {
    workspace: string;
    slug: string;
    environment: string;
    environment_slug: string;
  }[] = await manager.query(
    `SELECT w.name AS workspace, w.slug, e.name AS environment,
            e.slug AS environment_slug
     FROM nodrail.workspaces w
     JOIN nodrail.environments e ON e.workspace_id = w.id
     WHERE w.id = $1 AND e.id = $2`,
    [workspaceId, environmentId],
  );
  if (!row) throw new Error("Unknown place");
  return { ...row, base: appPath(row.slug, row.environment_slug) };
}
