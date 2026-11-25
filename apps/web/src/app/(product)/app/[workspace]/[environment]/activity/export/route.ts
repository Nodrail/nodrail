import {
  EXPORT_LIMIT,
  exportFormats,
  type ExportFormat,
} from "@/contracts/v1/activity-query";
import { exportText, exportTypes } from "@/features/activity/export-file";
import { readActivityParams } from "@/features/activity/filters";
import { workspaceDownload } from "@/server/http/download";
import {
  exportActivity,
  recordActivityExport,
} from "@/server/modules/activity/export";

/**
 * The events Activity lists for these filters, as a file: `?format=csv` or
 * `json` and the list's own filters. Recorded in the audit log.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspace: string; environment: string }> },
) {
  const { workspace, environment } = await params;
  const search = new URL(request.url).searchParams;
  const asked = search.get("format");
  const format: ExportFormat = exportFormats.includes(asked as ExportFormat)
    ? (asked as ExportFormat)
    : "csv";
  const { query } = readActivityParams(Object.fromEntries(search));
  const stamp = new Date().toISOString().slice(0, 10);
  return workspaceDownload(workspace, {
    type: exportTypes[format],
    name: (slug) =>
      `nodrail-${slug}-${environment}-activity-${stamp}.${format}`,
    body: async (context) => {
      const found = await exportActivity(context, environment, query);
      return {
        text: exportText(format, found.items, {
          capped: found.capped,
          limit: EXPORT_LIMIT,
        }),
        headers: {
          "x-nodrail-export-rows": String(found.items.length),
          ...(found.capped
            ? { "x-nodrail-export-limit": String(EXPORT_LIMIT) }
            : {}),
        },
        record: (context) =>
          recordActivityExport(context, {
            environmentId: found.environmentId,
            format,
            query: found.query,
            rows: found.items.length,
            capped: found.capped,
          }),
      };
    },
  });
}
