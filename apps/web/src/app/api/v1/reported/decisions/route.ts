import { listReportedDecisions } from "@/server/modules/reporting/list";
import { environmentList } from "@/server/public-api/route";

/** Decisions local hooks reported: evidence of local enforcement, read only. */
export const GET = environmentList(listReportedDecisions);
