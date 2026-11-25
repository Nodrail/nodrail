import { environmentQuery, revisionQuery } from "@/contracts/v1/public-api";
import {
  getIntendedRevision,
  publishIntendedRevision,
} from "@/server/modules/inventory";
import { publicRoute } from "@/server/public-api/route";

/** The revision the team intends for a project here, or null. */
export const GET = publicRoute(
  { scope: "read", access: "read", query: revisionQuery },
  async (context, call) => ({
    revision: await getIntendedRevision(
      context,
      call.environment,
      call.query.project_id,
    ),
  }),
);

/** Publishes the lock's revision as the one intended here; `rules:write`. */
export const POST = publicRoute(
  { scope: "rules:write", access: "write", query: environmentQuery },
  (context, call) =>
    publishIntendedRevision(context, call.environment, call.body),
);
