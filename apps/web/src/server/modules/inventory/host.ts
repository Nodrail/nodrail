import "server-only";
import { boundedJson } from "@/contracts/v1/runtime";
import { hostObservationInput } from "@/contracts/v1/runtime-inventory";
import { AppError, parseInput, type RuntimeContext } from "@/server/db/context";
import { runtimeCaller } from "@/server/modules/runtime/caller";
import { touch } from "@/server/modules/runtime/touch";
import { keepObservation } from "./index";

export async function recordHostObservation(
  context: RuntimeContext,
  body: unknown,
) {
  const report = parseInput(
    hostObservationInput,
    parseInput(boundedJson(12_000), body),
  );
  const [scope]: {
    project: string;
    machine: string;
    name: string;
    user_id: string;
  }[] = await context.manager.query(
    `SELECT to_jsonb(i)->>'enrollment_project_id' AS project,
            replace(to_jsonb(i)->>'enrollment_machine_id', '-', '') AS machine,
            coalesce(r.project, to_jsonb(i)->>'enrollment_project_id') AS name,
            owner.user_id
     FROM nodrail.installations i
     JOIN LATERAL (
       SELECT user_id FROM nodrail.agent_members m
       WHERE m.workspace_id = i.workspace_id AND m.agent_id = i.agent_id
       ORDER BY m.created_at, m.user_id LIMIT 1
     ) owner ON true
     LEFT JOIN nodrail.intended_revisions r ON r.workspace_id = i.workspace_id
       AND r.environment_id = i.environment_id
       AND r.project_id::text = to_jsonb(i)->>'enrollment_project_id'
     WHERE i.workspace_id = $1 AND i.id = $2`,
    [context.workspaceId, context.installationId],
  );
  if (!scope?.project || !scope.machine) throw new AppError("FORBIDDEN");

  if ("heartbeat" in report) {
    await touch(context);
    await context.manager.query(
      `UPDATE nodrail.inventory_reports
       SET last_seen_at = clock_timestamp()
       WHERE workspace_id = $1 AND environment_id = $2 AND user_id = $3
         AND machine = $4 AND project_key = $5 AND host = $6`,
      [
        context.workspaceId,
        context.environmentId,
        scope.user_id,
        scope.machine,
        scope.project,
        report.host,
      ],
    );
    return { recorded: true };
  }

  const caller = await runtimeCaller(context, report.agent);
  await keepObservation(
    context,
    { environmentId: context.environmentId, userId: scope.user_id },
    {
      project: { id: scope.project, name: scope.name },
      machine: scope.machine,
      host: report.host,
      agent: report.agent ? caller.agent : null,
      activation: report.activation,
      inStep: report.in_step,
      drift: report.drift,
      unmanaged: report.unmanaged,
      names: report.names ?? null,
      appliedRevision: report.applied_revision,
      lockedRevision: report.locked_revision,
      observedAt: new Date(),
    },
  );
  return { recorded: true };
}
