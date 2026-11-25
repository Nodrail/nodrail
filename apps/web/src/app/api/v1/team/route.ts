import { environmentQuery } from "@/contracts/v1/public-api";
import { getTeam } from "@/server/modules/team/members";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery },
  getTeam,
);
