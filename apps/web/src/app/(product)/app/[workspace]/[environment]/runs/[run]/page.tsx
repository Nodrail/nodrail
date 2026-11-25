import { redirect } from "next/navigation";
import { runPath } from "@/features/runs/presentation";
import { appPath } from "@/lib/product-path";

/**
 * A run's old address, still in links people were sent: its timeline
 * lives under Activity now, and answers 404 there for a run that isn't one.
 */
export default async function RunRedirect({
  params,
}: PageProps<"/app/[workspace]/[environment]/runs/[run]">) {
  const { workspace, environment, run } = await params;
  redirect(runPath(appPath(workspace, environment), encodeURIComponent(run)));
}
