import { environmentQuery } from "@/contracts/v1/public-api";
import { describeToken } from "@/server/public-api/me";
import { tokenRoute } from "@/server/public-api/route";

export const GET = tokenRoute(
  { scope: "read", access: "read", query: environmentQuery },
  (context) => describeToken(context),
);
