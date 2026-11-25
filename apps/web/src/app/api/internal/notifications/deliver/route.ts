import { NextResponse, type NextRequest } from "next/server";
import {
  deliverNotifications,
  queueStaleIntegrationAlerts,
} from "@/server/notifications/delivery";
import { applyRetention } from "@/server/maintenance/retention";
import { scheduled, schedulerAuthorized } from "@/server/operations/scheduler";

/**
 * Called by a scheduler. Retries, silence checks and retention (deleting what
 * the privacy notice says goes after its time) happen only here. Each run is
 * recorded, so readiness can tell an operator it happens.
 */
export async function POST(request: NextRequest) {
  if (!schedulerAuthorized(request))
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED" } },
      { status: 401 },
    );
  const result = await scheduled("deliver", async () => {
    const stale = await queueStaleIntegrationAlerts();
    const delivery = await deliverNotifications();
    const retention = await applyRetention();
    return { stale, ...delivery, retention };
  });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}

/** Vercel Cron calls with GET (`vercel.json`, daily). */
export const GET = POST;
