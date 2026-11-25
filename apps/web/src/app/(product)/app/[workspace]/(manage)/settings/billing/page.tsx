import type { Metadata } from "next";
import { BillingCard } from "@/features/settings/components/billing-card";
import { openManagePage } from "@/features/shell/components/manage-section";
import { readForPage } from "@/features/shell/load-view";
import { firstParam } from "@/lib/search-params";
import { getBilling } from "@/server/modules/billing";

export const metadata: Metadata = { title: "Billing & usage" };

export default async function BillingPage({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/settings/billing">) {
  const { workspace } = await params;
  const { header } = await openManagePage(workspace, "settings", "billing");
  const returned = firstParam((await searchParams).billing);
  const billing = await readForPage(workspace, getBilling);
  return (
    <>
      {header}
      <div className="grid gap-4">
        <BillingCard
          workspace={workspace}
          billing={billing}
          returned={returned}
        />
      </div>
    </>
  );
}
