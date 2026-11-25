"use client";

import { ChevronDown, Download } from "lucide-react";
import { track } from "@/components/analytics/posthog";
import { MenuChoice } from "@/components/app/menu-choice";
import { useToast } from "@/components/app/toast";
import { useDownload } from "@/components/app/use-download";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_LIMIT, type ExportFormat } from "@/contracts/v1/activity-query";

const limit = EXPORT_LIMIT.toLocaleString("en-US");

/**
 * CSV or JSON of the events these filters show, newest first, up to the
 * limit. The menu says so up front, and a message says so when it was reached.
 */
export function ExportMenu({
  hrefFor,
}: {
  hrefFor: Record<ExportFormat, string>;
}) {
  const download = useDownload();
  const toast = useToast();

  async function exportAs(format: ExportFormat) {
    const response = await download(
      hrefFor[format],
      "We could not export the activity. Please try again.",
    );
    if (!response) return;
    // Only that it happened: the filters can name agents and resources.
    track("activity_exported");
    if (response.headers.get("x-nodrail-export-limit"))
      toast(
        `Exported the newest ${limit} events. Narrow the filters or the time range to export older ones.`,
      );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" data-tour="activity-export">
          <Download aria-hidden="true" />
          Export
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          The events these filters show, newest first, up to {limit}.
        </DropdownMenuLabel>
        <MenuChoice
          title="CSV"
          detail="For spreadsheets. Times in UTC."
          onSelect={() => void exportAs("csv")}
        />
        <MenuChoice
          title="JSON"
          detail="For scripts and other tools."
          onSelect={() => void exportAs("json")}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
