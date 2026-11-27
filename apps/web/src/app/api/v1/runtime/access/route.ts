import { NextResponse } from "next/server";
import {
  idempotencyKey,
  policyDigest,
  runtimeAgent,
} from "@/contracts/v1/runtime";
import { AppError, parseInput } from "@/server/db/context";
import { admissionId } from "@/server/modules/runtime/admission";
import { runtimeCaller } from "@/server/modules/runtime/caller";
import { readRuntimeBinding } from "@/server/modules/runtime/identity";
import {
  pinnedRevision,
  requirePolicyOwnership,
} from "@/server/modules/runtime/policy-revision";
import { runtimeRoute } from "@/server/runtime-api";

export const GET = runtimeRoute("policy:read", async (context, { request }) => {
  const requested = parseInput(
    runtimeAgent,
    request.nextUrl.searchParams.get("agent") ?? undefined,
  );
  const query = request.nextUrl.searchParams;
  const call = parseInput(
    idempotencyKey.optional(),
    query.get("call") ?? undefined,
  );
  const digest = parseInput(
    policyDigest.nullable(),
    query.get("policy_digest"),
  );
  if (context.enrollmentProjectId) {
    await requirePolicyOwnership(context);
    const revision = parseInput(policyDigest, query.get("workspace_revision"));
    if (!digest || !(await pinnedRevision(context, digest, revision)))
      throw new AppError(
        "NOT_FOUND",
        "This policy and workspace revision are not published for the enrolled project. Run nodrail plan.",
      );
  }
  const caller = await runtimeCaller(context, requested);
  const { workspace, environment } = await readRuntimeBinding(context);
  return NextResponse.json(
    {
      agent: caller.agent,
      ...(call ? { admission_id: admissionId(caller, call, digest) } : {}),
      paused: caller.refusal !== null,
      ...(caller.refusal
        ? { reason: caller.refusal, paused_agents: caller.pausedAgents }
        : {}),
      workspace,
      environment,
      project_id: context.enrollmentProjectId ?? null,
    },
    {
      headers: { "cache-control": "private, no-store", vary: "Authorization" },
    },
  );
});
