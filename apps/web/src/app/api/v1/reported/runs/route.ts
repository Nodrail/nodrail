import { listLocalRuns } from "@/server/modules/reporting/list";
import { environmentList } from "@/server/public-api/route";

/** Local runs, as installations reported their steps: read only. */
export const GET = environmentList(listLocalRuns);
