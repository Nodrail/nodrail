import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import {
  descriptorDigest,
  redactPausedAction,
  type ActionDescriptor,
} from "@nodrail/sdk/protocol";
import {
  AppError,
  RecordedAccessDenial,
  type RuntimeContext,
} from "@/server/db/context";
import { recordRuntimeDecision } from "@/server/modules/audit";
import type { Place } from "@/server/modules/runs/history";
import type { runtimeCaller } from "./caller";
import { liveRevision } from "./policy-revision";
import { insertRequest } from "./records";

/** The original inputs are used for replay equality and never exposed. */
export function pauseReplayDigest(
  { pauseReplayKey }: RuntimeContext,
  digest: string,
) {
  return pauseReplayKey
    ? createHmac("sha256", pauseReplayKey)
        .update(`pause-replay:${digest}`)
        .digest("hex")
    : undefined;
}

/** A denial may appear in the timeline of an existing run without starting or touching it. */
export async function existingRun(
  { manager, workspaceId, environmentId, installationId }: RuntimeContext,
  key?: string,
): Promise<Place | null> {
  if (!key) return null;
  const [row]: { id: string }[] = await manager.query(
    `SELECT id FROM nodrail.runs
     WHERE workspace_id = $1 AND environment_id = $2 AND installation_id = $3
       AND key = $4 FOR NO KEY UPDATE`,
    [workspaceId, environmentId, installationId, key],
  );
  return row ? { runId: row.id, key, step: null } : null;
}

export function pauseDetail(caller: Awaited<ReturnType<typeof runtimeCaller>>) {
  const names = caller.pausedAgents;
  const listed = names.slice(0, 5).join(", ") || caller.agent;
  const more = names.length > 5 ? ` and ${names.length - 5} others` : "";
  return `Denied: ${listed}${more} paused`;
}

export async function recordServerPause(
  caller: Awaited<ReturnType<typeof runtimeCaller>>,
  input: {
    key: string;
    descriptor: ActionDescriptor;
    runKey?: string;
  },
) {
  const { context } = caller;
  const live = await liveRevision(context);
  if (!live) throw new AppError("BUSY");
  const id = randomUUID();
  const descriptor = redactPausedAction(input.descriptor);
  const replay = pauseReplayDigest(
    context,
    descriptorDigest(context.installationId, input.descriptor),
  );
  const inserted = await insertRequest(context, {
    id,
    key: input.key,
    adapterVersion: undefined,
    descriptor,
    digest: descriptorDigest(context.installationId, descriptor),
    ...(replay ? { pauseReplayDigest: replay } : {}),
    policyVersionId: live.id,
    accessEpoch: 0,
    evaluation: "denied",
    place: await existingRun(context, input.runKey),
    hold: null,
  });
  if (inserted)
    await recordRuntimeDecision(context, {
      eventType: "authorization.decided",
      decisionCode: "denied_agent_paused",
      actionRequestId: id,
      agentId: context.agentId,
      environmentId: context.environmentId,
      policyVersionId: live.id,
      payload: { detail: pauseDetail(caller) },
    });
}

export async function refuseSubmission(
  caller: Awaited<ReturnType<typeof runtimeCaller>>,
  input: Parameters<typeof recordServerPause>[1],
): Promise<never> {
  await recordServerPause(caller, input);
  throw new RecordedAccessDenial(caller.refusal!);
}
