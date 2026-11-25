import "server-only";
import type { RunPolicyDto } from "@/contracts/v1/runs";
import type { WorkspaceContext } from "@/server/db/context";
import { ActivePolicy, PolicyVersion } from "@/server/db/entities";
import { findEnvironment } from "@/server/modules/workspaces";
import type { RunPolicy } from "./history";

/** The live version's gates and budgets as stored: agents by id. */
export async function storedRunPolicy(
  context: WorkspaceContext,
  environmentId: string,
): Promise<RunPolicy> {
  return (await liveVersion(context, environmentId)).runPolicy;
}

async function liveVersion(
  { manager, workspaceId }: WorkspaceContext,
  environmentId: string,
) {
  const active = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId,
  });
  const version = await manager.findOneByOrFail(PolicyVersion, {
    workspaceId,
    id: active.policyVersionId,
  });
  return {
    revision: version.revision,
    runPolicy: (version.runPolicy as RunPolicy | null) ?? {
      gates: [],
      budgets: [],
    },
  };
}

/** The live version's gates and budgets, with agents by key. */
export async function activeRunPolicy(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<RunPolicyDto> {
  const { manager, workspaceId } = context;
  const { id: environmentId } = await findEnvironment(context, environmentSlug);
  const { revision, runPolicy: stored } = await liveVersion(
    context,
    environmentId,
  );
  if (!stored.gates.length && !stored.budgets.length)
    return { gates: [], budgets: [], revision };
  const agents: { id: string; external_key: string }[] = await manager.query(
    `SELECT id, external_key FROM nodrail.agents WHERE workspace_id = $1`,
    [workspaceId],
  );
  const keys = new Map(agents.map((row) => [row.id, row.external_key]));
  return {
    revision,
    gates: stored.gates.map((gate) => ({
      id: gate.id,
      name: gate.name,
      toolKey: gate.toolKey,
      operationKey: gate.operationKey,
      resource: gate.resource,
      agentKey: gate.agentKey ? (keys.get(gate.agentKey) ?? null) : null,
      requires: gate.requires,
      effect: gate.effect,
    })),
    budgets: stored.budgets.map(
      ({ id, name, agent, per, metric, limit, warnAt, effect }) => ({
        id,
        name,
        agent,
        per,
        metric,
        limit,
        warnAt,
        effect,
      }),
    ),
  };
}
