import { redirect } from "next/navigation";
import { reportWindow } from "@/contracts/v1/reports";
import { reportsPath } from "@/features/reports/presentation";
import { firstParam } from "@/lib/search-params";
import { appPath } from "@/lib/product-path";

/** Reports are Insights now, with the same window. */
export default async function ReportsRedirect({
  params,
  searchParams,
}: PageProps<"/app/[workspace]/[environment]/runs/reports">) {
  const { workspace, environment } = await params;
  const days = firstParam((await searchParams).days);
  redirect(
    reportsPath(
      appPath(workspace, environment),
      days ? reportWindow(days) : undefined,
    ),
  );
}
