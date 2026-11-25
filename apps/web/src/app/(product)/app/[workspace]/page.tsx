import { notFound, redirect } from "next/navigation";
import {
  defaultEnvironment,
  loadWorkspaceView,
} from "@/features/shell/load-view";
import { appPath } from "@/lib/product-path";

export default async function WorkspaceEntry({
  params,
}: PageProps<"/app/[workspace]">) {
  const view = await loadWorkspaceView((await params).workspace);
  const environment = defaultEnvironment(view);
  if (!environment) notFound();
  redirect(appPath(view.slug, environment.slug, "overview"));
}
