import { environmentQuery } from "@/contracts/v1/public-api";
import { createTokenBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { createApiToken, listApiTokens } from "@/server/modules/api-tokens";
import { publicRoute } from "@/server/public-api/route";

export const GET = publicRoute(
  { scope: "read", access: "read", query: environmentQuery, auth: "session" },
  listApiTokens,
);

export const POST = publicRoute(
  { scope: "read", access: "write", query: environmentQuery, auth: "session" },
  (context, call) => {
    const body = parseInput(createTokenBody, call.body);
    return createApiToken(context, {
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expires_in_days,
    });
  },
);
