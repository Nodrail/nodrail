import {
  MAX_POLICY_JSON_BYTES,
  environmentQuery,
  previewBody,
} from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { previewPolicyFile } from "@/server/modules/policies/rule-files";
import { publicRoute } from "@/server/public-api/route";

/**
 * Needs `rules:write`, as on screen: a preview is the first half of
 * publishing, and says what publishing would change.
 */
export const POST = publicRoute(
  {
    scope: "rules:write",
    access: "write",
    query: environmentQuery,
    maxBodyBytes: MAX_POLICY_JSON_BYTES,
  },
  (context, call) =>
    previewPolicyFile(
      context,
      call.environment,
      parseInput(previewBody, call.body).yaml,
    ),
);
