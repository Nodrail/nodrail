import { environmentQuery } from "@/contracts/v1/public-api";
import { policyImpactBody } from "@/contracts/v1/management";
import { parseInput } from "@/server/db/context";
import { previewImpact } from "@/server/modules/policies/impact";
import { publicRoute } from "@/server/public-api/route";

export const POST = publicRoute(
  { scope: "rules:write", access: "read", query: environmentQuery },
  (context, call) =>
    previewImpact(
      context,
      call.environment,
      parseInput(policyImpactBody, call.body),
    ),
);
