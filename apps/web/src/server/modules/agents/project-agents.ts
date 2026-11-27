import "server-only";
import type { Declarations } from "@/contracts/v1/project-apply";
import { AppError, type WorkspaceContext } from "@/server/db/context";

export type RegisteredAgent = {
  id: string;
  external_key: string;
  description: string | null;
  archived_at: Date | null;
  managed_project_id: string | null;
};

export async function registeredAgents(context: WorkspaceContext) {
  const rows: RegisteredAgent[] = await context.manager.query(
    `SELECT id, external_key, description, archived_at, managed_project_id
     FROM nodrail.agents WHERE workspace_id = $1`,
    [context.workspaceId],
  );
  return new Map(rows.map((row) => [row.external_key, row]));
}

/** Keep legacy and other projects' agent metadata under their current owner. */
export async function upsertProjectAgents(
  context: WorkspaceContext,
  declared: Declarations,
) {
  const { manager, workspaceId, principal } = context;
  for (const agent of [...declared.agents].sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    const rows: { id: string }[] = await manager.query(
      `INSERT INTO nodrail.agents AS a (workspace_id, external_key, description, managed_project_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (workspace_id, external_key) DO UPDATE SET description = EXCLUDED.description
       WHERE a.managed_project_id = $4 AND a.archived_at IS NULL
       RETURNING id`,
      [workspaceId, agent.key, agent.description, declared.project_id],
    );
    if (!rows.length)
      throw new AppError("INVALID_INPUT", agentConflict(agent.key));
  }
  await manager.query(
    `INSERT INTO nodrail.agent_members (workspace_id, agent_id, user_id)
     SELECT workspace_id, id, $2
     FROM nodrail.agents
     WHERE workspace_id = $1 AND managed_project_id = $3 AND archived_at IS NULL
       AND external_key = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [
      workspaceId,
      principal.userId,
      declared.project_id,
      declared.agents.map(({ key }) => key),
    ],
  );
}

const agentConflict = (key: string) =>
  `Declared agent "${key}" belongs to another project or was created outside enrollment. Rename it or ask a workspace admin to bind it to this project.`;

export async function projectAgentTargets(
  context: WorkspaceContext,
  declared?: Declarations,
) {
  const agents = await registeredAgents(context);
  const added: string[] = [];
  const changed: string[] = [];
  const issues: { line: number; column: number; message: string }[] = [];
  const names = new Map(
    [...agents.values()]
      .filter(
        (row) =>
          !row.archived_at &&
          (!declared ||
            (row.managed_project_id === declared.project_id &&
              declared.agents.some(({ key }) => key === row.external_key))),
      )
      .map((row) => [row.external_key, row.id]),
  );
  for (const agent of declared?.agents ?? []) {
    const existing = agents.get(agent.key);
    if (!existing) {
      names.set(agent.key, `declared:${agent.key}`);
      added.push(`agent ${agent.key}`);
    } else if (existing.archived_at) {
      issues.push({
        line: 0,
        column: 0,
        message: `Declared agent "${agent.key}" is archived. Rename it in the project.`,
      });
    } else if (existing.managed_project_id !== declared?.project_id) {
      issues.push({ line: 0, column: 0, message: agentConflict(agent.key) });
    } else if (existing.description !== agent.description) {
      changed.push(`agent ${agent.key}`);
    }
  }
  return { agents: names, added, changed, issues };
}
