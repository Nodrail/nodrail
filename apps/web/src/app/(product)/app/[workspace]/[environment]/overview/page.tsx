import type { Metadata } from "next";
import { LiveRefresh } from "@/components/app/live";
import { OverviewView } from "@/features/overview/overview-view";

export const metadata: Metadata = { title: "Overview" };

/** Kept current: new requests, expiries and first check-ins show on their own. */
export default async function OverviewPage({
  params,
}: PageProps<"/app/[workspace]/[environment]/overview">) {
  const { workspace, environment } = await params;
  return (
    <>
      <OverviewView workspace={workspace} environment={environment} />
      <LiveRefresh />
    </>
  );
}
