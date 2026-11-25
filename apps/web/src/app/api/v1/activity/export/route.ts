import { EXPORT_LIMIT } from "@/contracts/v1/activity-query";
import {
  activityExportBody,
  environmentQuery,
} from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import {
  exportActivity,
  recordActivityExport,
} from "@/server/modules/activity/export";
import { publicRoute } from "@/server/public-api/route";

export const POST = publicRoute(
  { scope: "read", access: "write", query: environmentQuery },
  async (context, call) => {
    const filters = parseInput(activityExportBody, call.body);
    // Select with the same row visibility as Activity, then record the export.
    await context.manager.query("SET LOCAL ROLE nodrail_member_read");
    const { items, capped, environmentId, query } = await exportActivity(
      context,
      call.environment,
      filters,
    );
    await context.manager.query("RESET ROLE");
    await recordActivityExport(context, {
      environmentId,
      format: "json",
      query,
      rows: items.length,
      capped,
    });
    return { items, capped, limit: EXPORT_LIMIT };
  },
);
