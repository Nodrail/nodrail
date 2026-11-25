import { setTimeout as sleep } from "node:timers/promises";

const { SCHEDULER_URL, NOTIFICATIONS_SECRET, SCHEDULER_EVERY_SECONDS } =
  process.env;
if (!SCHEDULER_URL || !NOTIFICATIONS_SECRET)
  throw new Error("Set SCHEDULER_URL and NOTIFICATIONS_SECRET");

const interval = Number(SCHEDULER_EVERY_SECONDS ?? 0);
if (!Number.isInteger(interval) || interval < 0 || interval > 86400)
  throw new Error("SCHEDULER_EVERY_SECONDS must be an integer from 0 to 86400");

const endpoint = new URL("/api/internal/notifications/deliver", SCHEDULER_URL);

async function deliver() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${NOTIFICATIONS_SECRET}` },
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  await response.body?.cancel();
  if (!response.ok)
    throw new Error(`Delivery returned HTTP ${response.status}`);
}

do {
  try {
    await deliver();
  } catch (error) {
    if (interval === 0) throw error;
    console.error("Scheduled delivery failed", error.message);
  }
  if (interval > 0) await sleep(interval * 1000);
} while (interval > 0);
