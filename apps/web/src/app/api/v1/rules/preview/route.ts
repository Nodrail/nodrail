import {
  MAX_POLICY_JSON_BYTES,
  environmentQuery,
} from "@/contracts/v1/public-api";
import { projectPreviewBody } from "@/contracts/v1/project-apply";
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
    maxBodyBytes: MAX_POLICY_JSON_BYTES + 8_000_000,
  },
  (context, call) => {
    const input = parseInput(projectPreviewBody, call.body);
    return previewPolicyFile(context, call.environment, input.yaml, input);
  },
);
