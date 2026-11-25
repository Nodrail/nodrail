"use server";

import type { ActivityDetailDto } from "@/contracts/v1/activity";
import { readForClient } from "@/features/shell/load-view";
import { getActivityEvent } from "@/server/modules/activity";

/**
 * One event for the panel over the list, read as the list was. Null when it
 * does not exist or this person may not see it.
 */
export async function readActivityEvent(
  workspace: string,
  environment: string,
  eventId: string,
): Promise<ActivityDetailDto | null> {
  return readForClient(workspace, (context) =>
    getActivityEvent(context, environment, eventId),
  );
}
