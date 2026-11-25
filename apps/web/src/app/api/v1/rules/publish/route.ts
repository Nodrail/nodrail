import {
  MAX_POLICY_JSON_BYTES,
  environmentQuery,
  publishBody,
} from "@/contracts/v1/public-api";
import { parseInput } from "@/server/db/context";
import { applyPolicyFile } from "@/server/modules/policies/rule-files";
import { publicRoute } from "@/server/public-api/route";

/** Publishes exactly the file that was previewed, or refuses. */
export const POST = publicRoute(
  {
    scope: "rules:write",
    access: "write",
    query: environmentQuery,
    maxBodyBytes: MAX_POLICY_JSON_BYTES,
  },
  (context, call) => {
    const body = parseInput(publishBody, call.body);
    return applyPolicyFile(context, call.environment, body.yaml, {
      revision: body.policy_revision,
      fileDigest: body.file_digest,
      managed: body.managed ?? null,
    });
  },
);
