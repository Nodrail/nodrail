import { redirect } from "next/navigation";
import { appPath } from "@/lib/product-path";

/** Runs are a view of Activity now. */
export default async function RunsPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/runs">) {
  const { workspace, environment } = await params;
  redirect(appPath(workspace, environment, "activity?view=runs"));
}
