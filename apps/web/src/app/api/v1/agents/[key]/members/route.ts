import { environmentQuery } from "@/contracts/v1/public-api";
import { memberBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { assignAgent, getAgentPeople } from "@/server/modules/team/members";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute<{ key: string }>(
  { scope: "members:manage", access: "read", query: environmentQuery },
  (context, call) => getAgentPeople(context, call.params.key),
);

export const POST = publicRoute<{ key: string }>(
  { scope: "members:manage", access: "write", query: environmentQuery },
  (context, call) =>
    assignAgent(
      context,
      call.params.key,
      parseInput(memberBody, call.body).user_id,
    ),
);
