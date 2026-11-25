import { environmentQuery } from "@/contracts/v1/public-api";
import { getTeam } from "@/server/modules/team/members";
import { createInvite } from "@/server/modules/team/invites";
import { publicRoute } from "@/server/public-api/route";
import { page } from "@/server/public-api/wire";

export const GET = publicRoute(
  { scope: "members:manage", access: "read", query: environmentQuery },
  async (context) => page((await getTeam(context)).invites ?? []),
);

export const POST = publicRoute(
  { scope: "members:manage", access: "write", query: environmentQuery },
  (context, call) => createInvite(context, call.body),
);
