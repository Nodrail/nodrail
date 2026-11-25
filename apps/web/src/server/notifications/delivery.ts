import "server-only";
import { REPORTING_WINDOW_MINUTES } from "@/contracts/v1/agents";
import type {
  NotificationKind,
  NotificationPayloads,
} from "@/contracts/v1/notifications";
import { asNotifier, asSystem } from "@/server/db/context";
import { emailConfigured, sendEmail, type SendEmail } from "./mailer";
import { enqueueNotification, placeNames } from "./outbox";
import { renderNotification } from "./render";

const MAX_ATTEMPTS = 5;
const BATCH = 25;
const LEASE_SECONDS = 60;
/** Minutes before each retry. */
const BACKOFF = [1, 5, 30, 120];

type Claimed = {
  id: string;
  kind: NotificationKind;
  recipient_email: string;
  payload_safe: NotificationPayloads[NotificationKind];
  attempts: number;
};

/** A short transaction: the lease is what keeps others away during sending. */
function claimBatch(size: number): Promise<Claimed[]> {
  return asNotifier(async (manager) => {
    await manager.query(
      `UPDATE nodrail.notification_outbox SET state = 'failed'
       WHERE state = 'sending' AND lease_until <= clock_timestamp()
         AND attempts >= $1`,
      [MAX_ATTEMPTS],
    );
    const [rows]: [Claimed[], number] = await manager.query(
      `UPDATE nodrail.notification_outbox o
       SET state = 'sending', attempts = o.attempts + 1,
           lease_until = clock_timestamp() + make_interval(secs => $2)
       WHERE o.id IN (
         SELECT id FROM nodrail.notification_outbox
         WHERE (state = 'pending' AND available_at <= clock_timestamp())
            OR (state = 'sending' AND lease_until <= clock_timestamp())
         ORDER BY available_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED)
       RETURNING o.id, o.kind, o.recipient_email, o.payload_safe, o.attempts`,
      [size, LEASE_SECONDS],
    );
    return rows;
  });
}

const settle = (id: string, sql: string, values: unknown[] = []) =>
  asNotifier((manager) =>
    manager.query(
      `UPDATE nodrail.notification_outbox SET ${sql} WHERE id = $1`,
      [id, ...values],
    ),
  );

function retryOrFail(item: Claimed, error: unknown) {
  // Provider messages can quote addresses, so only the type is kept.
  const reason = error instanceof Error ? error.name : "Error";
  const delay = BACKOFF[item.attempts - 1];
  return item.attempts >= MAX_ATTEMPTS || delay === undefined
    ? settle(item.id, `state = 'failed', last_error = $2`, [reason])
    : settle(
        item.id,
        `state = 'pending', last_error = $2,
         available_at = clock_timestamp() + make_interval(mins => $3)`,
        [reason, delay],
      );
}

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

  for (const item of await claimBatch(options.batch ?? BATCH)) {
    const { expiresAt } = item.payload_safe;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      await settle(item.id, `state = 'dropped'`);
      result.dropped += 1;
      continue;
    }
    try {
      await send({
        ...renderNotification(item.kind, item.payload_safe, origin),
        to: item.recipient_email,
        messageId: item.id,
      });
    } catch (error) {
      await retryOrFail(item, error);
      result.retried += 1;
      continue;
    }
    await settle(
      item.id,
      `state = 'delivered', delivered_at = clock_timestamp(), lease_until = NULL`,
    );
    result.delivered += 1;
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
