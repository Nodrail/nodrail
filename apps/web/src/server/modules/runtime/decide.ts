import "server-only";
import type { ActionDescriptor } from "@nodrail/client/protocol";
import type { Descriptor, SimulationResult } from "@nodrail/policy-engine";
import { AppError, type RuntimeContext } from "@/server/db/context";
import {
  decideInRun,
  versionDocument,
  type Place,
} from "@/server/modules/runs/history";

/** The environment's live version, as the engine reads it. */
export async function activePolicy(context: RuntimeContext) {
  const { manager, workspaceId, environmentId } = context;
  const [active]: { policy_version_id: string }[] = await manager.query(
    `SELECT policy_version_id FROM nodrail.active_policies
     WHERE workspace_id = $1 AND environment_id = $2`,
    [workspaceId, environmentId],
  );
  if (!active) throw new AppError("BUSY");
  return {
    policyVersionId: active.policy_version_id,
    document: await versionDocument(context, active.policy_version_id),
  };
}

const descriptorFor = (
  context: RuntimeContext,
  descriptor: ActionDescriptor,
): Descriptor => ({
  agentId: context.agentId,
  installationId: context.installationId,
  toolKey: descriptor.tool,
  operationKey: descriptor.operation,
  resourceKind: descriptor.resource.kind,
  resourceId: descriptor.resource.id,
  params: descriptor.params,
});

export type ActivePolicy = Awaited<ReturnType<typeof activePolicy>>;

/**
 * Whether this version's decisions read run history, so runs are locked:
 * every version with gates and budgets (document version 2 and up).
 */
export const readsRuns = ({ document }: ActivePolicy) => document.version !== 1;

/**
 * The active version decides, with the run's history when it has one, and
 * Cloud's count of each numeric budget covering the call. `lock` (the
 * permit): those budgets' windows are locked first, after the action and
 * its run, so the count stays true until the permit's transaction ends.
 */
export async function judge(
  context: RuntimeContext,
  { policyVersionId, document }: ActivePolicy,
  descriptor: ActionDescriptor,
  {
    place,
    beforeActionId,
    lock = false,
  }: { place: Place | null; beforeActionId?: string; lock?: boolean },
) {
  const verdict = await decideInRun(context, {
    document,
    descriptor: descriptorFor(context, descriptor),
    place,
    beforeActionId,
    lockBudgets: lock,
  });
  return { policyVersionId, verdict };
}

/** Only an allow goes ahead; a deny, and a call no rule covers, are denied. */
export type InitialEvaluation = "ready" | "denied";

export const initialFor: Record<
  SimulationResult["outcome"],
  InitialEvaluation
> = {
  allow: "ready",
  none: "denied",
  deny: "denied",
};
