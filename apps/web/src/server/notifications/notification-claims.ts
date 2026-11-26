import "server-only";
import type { EntityManager } from "typeorm";
import type {
  NotificationKind,
  NotificationPayloads,
} from "@/contracts/v1/notifications";
import { asNotifier } from "@/server/db/context";
import type { SendEmail } from "./mailer";
import { renderNotification } from "./render";

const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 60;
const SEND_SECONDS = 20;
/** Minutes before each retry. */
const BACKOFF = [1, 5, 30, 120];

type Claim = { id: string; lease: string };
type Claimed = Claim & {
  kind: NotificationKind;
  recipient_email: string;
  payload_safe: NotificationPayloads[NotificationKind];
  attempts: number;
};

// Keep the database's full timestamp precision in the claim.
const ownsClaim =
  "id = $1 AND state = 'sending' AND lease_until = $2::timestamptz";

function beginDelivery() {
  return asNotifier(async (manager) => {
    await manager.query(
      `UPDATE nodrail.notification_outbox SET state = 'failed', lease_until = NULL
       WHERE id IN (
         SELECT id FROM nodrail.notification_outbox
         WHERE state = 'sending' AND lease_until <= clock_timestamp()
           AND attempts >= $1
         FOR UPDATE SKIP LOCKED)`,
      [MAX_ATTEMPTS],
    );
    const [item]: Claimed[] = await manager.query(
      `WITH claimed AS (
         UPDATE nodrail.notification_outbox SET state = 'sending',
           lease_until = clock_timestamp() + make_interval(secs => $1)
         WHERE id = (
           SELECT id FROM nodrail.notification_outbox
           WHERE (state = 'pending' AND available_at <= clock_timestamp())
              OR (state = 'sending' AND lease_until <= clock_timestamp() AND attempts < $2)
           ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
         )
         RETURNING id, kind, recipient_email, payload_safe, attempts, lease_until
       ) SELECT id, kind, recipient_email, payload_safe, attempts,
                lease_until::text AS lease FROM claimed`,
      [LEASE_SECONDS, MAX_ATTEMPTS],
    );
    if (!item) return null;
    const { expiresAt } = item.payload_safe;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      await settle(manager, item, "state = 'dropped'");
      return "dropped" as const;
    }
    await manager.query(
      "UPDATE nodrail.notification_outbox SET attempts = attempts + 1 WHERE id = $1",
      [item.id],
    );
    return { ...item, attempts: item.attempts + 1 };
  });
}

const settle = (
  manager: EntityManager,
  claim: Claim,
  sql: string,
  values: unknown[] = [],
) =>
  manager.query(
    `WITH settled AS (
       UPDATE nodrail.notification_outbox SET lease_until = NULL, ${sql}
       WHERE ${ownsClaim} RETURNING id
     ) SELECT id FROM settled`,
    [claim.id, claim.lease, ...values],
  ) as Promise<{ id: string }[]>;

function retryOrFail(
  manager: EntityManager,
  claim: Claim,
  attempts: number,
  error: unknown,
) {
  // Provider messages can quote addresses, so only the type is kept.
  const reason = error instanceof Error ? error.name : "Error";
  const delay = BACKOFF[attempts - 1];
  return delay === undefined
    ? settle(manager, claim, "state = 'failed', last_error = $3", [reason])
    : settle(
        manager,
        claim,
        `state = 'pending', last_error = $3,
         available_at = clock_timestamp() + make_interval(mins => $4)`,
        [reason, delay],
      );
}

/**
 * Commit the attempt before SMTP. Then take the row lock again immediately
 * before starting it. SMTP runs outside the transaction so erasure can
 * scrub and drop the row while a send is in flight.
 * A crash after SMTP accepts the message and before settlement can duplicate
 * delivery when the lease expires. Each lease starts at most one send.
 */
export async function deliverNextNotification(send: SendEmail, origin: string) {
  const item = await beginDelivery();
  if (!item || item === "dropped") return item;
  const ready = await asNotifier(async (manager) => {
    // Test remaining time after the row lock is acquired. Leave a margin for
    // the deadline to fire before the lease could be reclaimed on connection loss.
    const [active]: { enough_time: boolean }[] = await manager.query(
      `WITH locked AS MATERIALIZED (
         SELECT lease_until FROM nodrail.notification_outbox
         WHERE ${ownsClaim} FOR UPDATE
       ) SELECT lease_until > clock_timestamp() + make_interval(secs => $3) AS enough_time
         FROM locked`,
      [item.id, item.lease, SEND_SECONDS + 5],
    );
    if (!active?.enough_time) return "superseded";
    const { expiresAt } = item.payload_safe;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      await settle(manager, item, "state = 'dropped'");
      return "dropped";
    }
    return "ready";
  });
  if (ready !== "ready") return ready;

  try {
    await send(
      {
        ...renderNotification(item.kind, item.payload_safe, origin),
        to: item.recipient_email,
        messageId: item.id,
      },
      AbortSignal.timeout(SEND_SECONDS * 1000),
    );
  } catch (error) {
    const retried = await asNotifier((manager) =>
      retryOrFail(manager, item, item.attempts, error),
    );
    return retried.length ? "retried" : "superseded";
  }

  return asNotifier(async (manager) => {
    const delivered = await settle(
      manager,
      item,
      "state = 'delivered', delivered_at = clock_timestamp()",
    );
    if (delivered.length) return "delivered";
    // Erasure is terminal. Keep the scrubbed row dropped and annotate
    // the completion of the already admitted send for this exact lease.
    await manager.query(
      `UPDATE nodrail.notification_outbox
       SET lease_until = NULL, delivered_at = clock_timestamp(),
           last_error = 'sent before erasure'
       WHERE id = $1 AND state = 'dropped' AND lease_until = $2::timestamptz`,
      [item.id, item.lease],
    );
    return "superseded";
  });
}
