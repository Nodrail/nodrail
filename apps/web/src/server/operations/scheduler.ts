import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { asMaintenance } from "@/server/db/context";
import { describeError } from "@/server/log";
import { digestSecret } from "@/server/security/secrets";

/**
 * The scheduler's own endpoints: NOTIFICATIONS_SECRET for any scheduler
 * (the self-hosted compose file's included), CRON_SECRET for Vercel Cron.
 * Either may be unset.
 */
export function schedulerAuthorized(request: NextRequest) {
  const given = Buffer.from(
    digestSecret(request.headers.get("authorization") ?? ""),
  );
  return [process.env.NOTIFICATIONS_SECRET, process.env.CRON_SECRET].some(
    (secret) =>
      Boolean(secret) &&
      timingSafeEqual(given, Buffer.from(digestSecret(`Bearer ${secret}`))),
  );
}

const record = (job: string, sql: string, values: unknown[] = []) =>
  asMaintenance((manager) =>
    manager
      .query(
        `INSERT INTO nodrail.scheduled_runs (job) VALUES ($1)
       ON CONFLICT (job) DO NOTHING`,
        [job],
      )
      .then(() => manager.query(sql, [job, ...values])),
  );

/**
 * Runs a scheduled job and records when it started, succeeded or failed, so
 * readiness can say it happens. A failure keeps only its error's code.
 */
export async function scheduled<T>(job: string, work: () => Promise<T>) {
  await record(
    job,
    `UPDATE nodrail.scheduled_runs
     SET last_started_at = clock_timestamp(), runs = runs + 1 WHERE job = $1`,
  );
  try {
    const result = await work();
    await record(
      job,
      `UPDATE nodrail.scheduled_runs
       SET last_succeeded_at = clock_timestamp() WHERE job = $1`,
    );
    return result;
  } catch (error) {
    const described = describeError(error);
    const code = String(
      "code" in described ? described.code : described.name,
    ).slice(0, 100);
    await record(
      job,
      `UPDATE nodrail.scheduled_runs
       SET last_failed_at = clock_timestamp(), last_error = $2 WHERE job = $1`,
      [code],
    );
    throw error;
  }
}

export type ScheduledRunDto = {
  job: string;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  runs: number;
};

export async function scheduledRuns(): Promise<ScheduledRunDto[]> {
  const rows: {
    job: string;
    last_started_at: Date | null;
    last_succeeded_at: Date | null;
    last_failed_at: Date | null;
    last_error: string | null;
    runs: number;
  }[] = await asMaintenance((manager) =>
    manager.query(
      `SELECT job, last_started_at, last_succeeded_at, last_failed_at,
              last_error, runs
       FROM nodrail.scheduled_runs ORDER BY job`,
    ),
  );
  return rows.map((row) => ({
    job: row.job,
    lastStartedAt: row.last_started_at?.toISOString() ?? null,
    lastSucceededAt: row.last_succeeded_at?.toISOString() ?? null,
    lastFailedAt: row.last_failed_at?.toISOString() ?? null,
    lastError: row.last_error,
    runs: row.runs,
  }));
}
