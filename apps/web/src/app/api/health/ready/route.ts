import { NextResponse, type NextRequest } from "next/server";
import { appOrigin } from "@/server/app-origin";
import { asAuthenticator, asNotifier } from "@/server/db/context";
import { deploymentMode } from "@/server/deployment";
import { describeError } from "@/server/log";
import {
  scheduledRuns,
  schedulerAuthorized,
} from "@/server/operations/scheduler";

export const dynamic = "force-dynamic";

/**
 * The scheduler should call at least this often; older is stale. The
 * self-hosted compose file calls every 5 minutes, Vercel Cron daily.
 */
const SCHEDULER_STALE_MS = {
  "self-hosted": 2 * 60 * 60 * 1000,
  cloud: 26 * 60 * 60 * 1000,
} as const;

const configured = (...names: string[]) =>
  names.every((name) => Boolean(process.env[name]));

/**
 * For the operator, with the scheduler's secret: what each dependency
 * looks like, not just the database. `/api/health` stays the public
 * liveness check; this says whether sign-in, email and the scheduler are
 * set up, and when delivery and retention last ran. It sends no email and
 * calls no outside service, so "configured" is not "working".
 */
export async function GET(request: NextRequest) {
  if (!schedulerAuthorized(request))
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 },
    );
  let database: "ok" | "unavailable" = "ok";
  let auth: "configured" | "missing" = "missing";
  let runs: Awaited<ReturnType<typeof scheduledRuns>> = [];
  try {
    await asNotifier((manager) => manager.query("SELECT 1"));
    runs = await scheduledRuns();
  } catch (error) {
    console.error("Readiness check failed", describeError(error));
    database = "unavailable";
  }
  try {
    appOrigin();
    await asAuthenticator((manager) =>
      manager.query("SELECT user_id FROM nodrail.login_accounts LIMIT 1"),
    );
    auth = "configured";
  } catch (error) {
    console.error("Login readiness check failed", describeError(error));
  }
  const deliver = runs.find((run) => run.job === "deliver") ?? null;
  const lastSuccess = deliver?.lastSucceededAt
    ? Date.parse(deliver.lastSucceededAt)
    : null;
  const checks = {
    database,
    auth,
    email: configured("SMTP_URL", "NOTIFICATIONS_FROM")
      ? "configured"
      : "missing",
    scheduler:
      lastSuccess === null
        ? "never run"
        : Date.now() - lastSuccess > SCHEDULER_STALE_MS[deploymentMode()]
          ? "stale"
          : "ok",
  };
  const ready =
    checks.database === "ok" &&
    checks.auth === "configured" &&
    checks.scheduler === "ok";
  return NextResponse.json(
    { ready, deployment: deploymentMode(), checks, scheduler: deliver },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
