import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { readRuntimePolicy } from "@/server/modules/policies/managed";
import { requirePolicyOwnership } from "@/server/modules/runtime/policy-revision";
import { runtimeRoute } from "@/server/runtime-api";

/**
 * The live policy of the credential's environment, for a host's data plane
 * (`policy:read`): its revision, the project and lock it came from, and the
 * file it was published from with its SHA-256. It changes nothing.
 */
export const GET = runtimeRoute("policy:read", async (context, { request }) => {
  await requirePolicyOwnership(context);
  const policy = await readRuntimePolicy(context);
  const etag = `"${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}"`;
  const headers = {
    etag,
    "cache-control": "private, no-cache",
    vary: "Authorization",
  };
  const tags = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((tag) => tag.trim());
  if (
    !("denial_reason" in policy) &&
    tags?.some((tag) => tag === "*" || tag.replace(/^W\//, "") === etag)
  )
    return new NextResponse(null, { status: 304, headers });
  return NextResponse.json(policy, { headers });
});
