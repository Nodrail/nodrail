import { environmentQuery } from "@/contracts/v1/public-api";
import { memberBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { transferOwnership } from "@/server/modules/team/members";
import { publicRoute } from "@/server/public-api/route";

export const POST = publicRoute(
  { scope: "read", access: "write", query: environmentQuery, auth: "session" },
  (context, call) =>
    transferOwnership(context, parseInput(memberBody, call.body).user_id),
);
