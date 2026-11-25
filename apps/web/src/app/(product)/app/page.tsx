import { redirect } from "next/navigation";
import { requirePrincipal } from "@/server/auth/current";
import {
  getWorkspaceView,
  listMyWorkspaces,
} from "@/server/modules/workspaces";
import { appPath } from "@/lib/product-path";

export default async function AppEntry() {
  const principal = await requirePrincipal();
  const [first] = await listMyWorkspaces(principal);
  if (!first) redirect(appPath("new"));
  const view = await getWorkspaceView(principal, first.slug);
  redirect(appPath(view.slug));
}
