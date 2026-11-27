import "server-only";
import { REPORTING_WINDOW_MINUTES } from "@/contracts/v1/agents";
import { asNotifier, asSystem } from "@/server/db/context";
import { emailConfigured, sendEmail, type SendEmail } from "./mailer";
import { enqueueNotification, placeNames } from "./outbox";
import { deliverNextNotification } from "./notification-claims";

const BATCH = 25;

export type DeliveryResult = {
  delivered: number;
  retried: number;
  dropped: number;
};

/** At least once: a crash after sending can repeat an email, never lose state. */
export async function deliverNotifications(
  options: { send?: SendEmail; batch?: number; origin?: string } = {},
): Promise<DeliveryResult> {
  const result: DeliveryResult = { delivered: 0, retried: 0, dropped: 0 };
  const send = options.send ?? sendEmail;
  if (!options.send && !emailConfigured()) return result;
  const origin = options.origin ?? process.env.APP_ORIGIN ?? "";

  for (let attempt = 0; attempt < (options.batch ?? BATCH); attempt += 1) {
    const outcome = await deliverNextNotification(send, origin);
    if (outcome === null) break;
    if (outcome !== "superseded") result[outcome] += 1;
  }
  return result;
}

/** Queues one alert per silence. A later check-in makes the next one possible. */
export async function queueStaleIntegrationAlerts(): Promise<number> {
  const workspaces = await asNotifier((manager): Promise<{ id: string }[]> =>
    manager.query(
      `SELECT id FROM nodrail.workspaces WHERE archived_at IS NULL LIMIT 5000`,
    ),
  );
  let found = 0;
  for (const { id } of workspaces)
    found += await asSystem(id, async ({ manager, workspaceId }) => {
      const stale: {
        name: string;
        last_seen_at: Date;
        agent_id: string;
        external_key: string;
        environment_id: string;
      }[] = await manager.query(
        `SELECT i.name, i.last_seen_at, i.agent_id, a.external_key, i.environment_id
         FROM nodrail.installations i
         JOIN nodrail.agents a
           ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
         WHERE i.workspace_id = $1 AND i.archived_at IS NULL
           AND a.archived_at IS NULL AND a.access_status = 'active'
           AND i.last_seen_at <= clock_timestamp() - make_interval(mins => $2)
         LIMIT 200`,
        [workspaceId, REPORTING_WINDOW_MINUTES],
      );
      for (const install of stale) {
        const place = await placeNames(
          { manager, workspaceId },
          install.environment_id,
        );
        await enqueueNotification(
          { manager, workspaceId },
          {
            kind: "integration_stale",
            agentId: install.agent_id,
            dedupe: `${install.name}:${install.last_seen_at.getTime()}`,
            payload: {
              workspace: place.workspace,
              environment: place.environment,
              agent: install.external_key,
              subject: install.name,
              reference: null,
              path: `${place.base}/agents/${install.external_key}`,
              expiresAt: null,
            },
          },
        );
      }
      return stale.length;
    });
  return found;
}
