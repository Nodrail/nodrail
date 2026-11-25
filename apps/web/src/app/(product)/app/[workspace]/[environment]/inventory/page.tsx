import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/app/skeleton-lists";
import { LoadingPage } from "@/components/app/skeletons";
import { InventoryTable } from "@/features/inventory/components/inventory-table";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView } from "@/features/shell/load-view";
import { allSections } from "@/features/shell/navigation";

export const metadata: Metadata = { title: "Inventory" };

const section = allSections.find((item) => item.slug === "inventory");

/** Each machine's setup of each project, as its last session start saw it. */
export default async function InventoryPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/inventory">) {
  const { workspace, environment } = await params;
  await loadWorkspaceView(workspace);
  return (
    <>
      <PageHeader title="Inventory" purpose={section?.purpose ?? ""} />
      <Suspense
        fallback={
          <LoadingPage label="inventory">
            <ListSkeleton rows={4} boxed lines={2} />
          </LoadingPage>
        }
      >
        <InventoryTable workspace={workspace} environment={environment} />
      </Suspense>
    </>
  );
}
