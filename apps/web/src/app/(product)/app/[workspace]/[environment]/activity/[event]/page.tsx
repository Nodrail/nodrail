import { redirect } from "next/navigation";
import { readForPage } from "@/features/shell/load-view";
import { getActivityEvent } from "@/server/modules/activity";
import { appPath } from "@/lib/product-path";

/**
 * The old address of one event, still in emails and bookmarks: the event now
 * opens in a panel over the list, as `?event=<id>`. Checked first, so an
 * event that does not exist, or is not this person's to see, stays a 404.
 */
export default async function ActivityEventPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/activity/[event]">) {
  const { workspace, environment, event: eventId } = await params;
  const event = await readForPage(workspace, (context) =>
    getActivityEvent(context, environment, eventId),
  );
  redirect(
    appPath(
      workspace,
      environment,
      `activity?event=${encodeURIComponent(event.id)}`,
    ),
  );
}
