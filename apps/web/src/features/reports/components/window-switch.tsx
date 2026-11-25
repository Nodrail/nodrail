import Link from "next/link";
import { Segmented } from "@/components/app/list-filters";
import { reportWindows, type ReportWindow } from "@/contracts/v1/reports";
import { reportsPath } from "../presentation";

/** The window lives in the URL, so a report can be linked as shown. */
export function WindowSwitch({
  base,
  days,
}: {
  base: string;
  days: ReportWindow;
}) {
  return (
    <Segmented as="nav" aria-label="Report window" data-tour="insights-window">
      {reportWindows.map((option) => (
        <Link
          key={option}
          href={reportsPath(base, option)}
          aria-current={option === days ? "page" : undefined}
        >
          {option} days
        </Link>
      ))}
    </Segmented>
  );
}
