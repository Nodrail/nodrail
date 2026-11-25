import { redirect } from "next/navigation";
import { appPath } from "@/lib/product-path";

/** The runs are Activity's other view, not a page of their own. */
export default async function ActivityRunsPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/activity/runs">) {
  const { workspace, environment } = await params;
  redirect(appPath(workspace, environment, "activity?view=runs"));
}
