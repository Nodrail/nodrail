import "server-only";
import { z } from "zod";
import {
  connectAgentInput,
  type AccessChangeDto,
  type AgentDetailDto,
  type AgentOptionDto,
  type ConnectedAgentDto,
  type CredentialDto,
  type IssuedCredentialDto,
  type ObservedOutcome,
} from "@/contracts/v1/agents";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { RUNTIME_SCOPES } from "@/server/db/runtime-scopes";
import { Agent, AgentMember, Installation } from "@/server/db/entities";
import { recordAudit } from "@/server/modules/audit";
import { findEnvironment } from "@/server/modules/workspaces";
import {
  closeCredential,
  issueCredential,
  supportedHostScopes,
} from "./credentials";

import {
  accessColumns,
  admittedAgent,
  installationOwner,
  installationRow,
  installationSelect,
  toAccess,
  toInstallation,
} from "./installation-view";

export { countAgents, listAgents } from "./list";

const detailRow = z.object({
  id: z.uuid(),
  managed_project_id: z.uuid().nullable(),
  project_name: z.string().nullable(),
  entry_agent: z.string().nullable(),
  external_key: z.string(),
  description: z.string().nullable(),
  ...accessColumns,
});

const observedRow = z.object({
  installation_name: z.string(),
  tool_key: z.string(),
  operation_key: z.string(),
  resource_kind: z.string(),
  resource_label: z.string(),
  last_outcome: z.string(),
  attempt_count: z.number(),
  last_seen_at: z.date(),
});

const credentialRow = z.object({
  id: z.uuid(),
  installation_id: z.uuid(),
  public_prefix: z.string(),
  created_at: z.date(),
  last_used_at: z.date().nullable(),
  revoked_at: z.date().nullable(),
});

export async function getAgent(
  context: WorkspaceContext,
  agentKey: string,
  environmentSlug: string,
): Promise<AgentDetailDto> {
  const { manager, workspaceId } = context;
  const environment = await findEnvironment(context, environmentSlug);

  const [agent] = parseRows(
    detailRow,
    await manager.query(
      `SELECT a.id, a.external_key, a.description, a.managed_project_id, a.access_status, a.paused_at,
              p.display_name AS paused_by_name, r.project AS project_name, r.entry_agent
       FROM nodrail.agents a
       LEFT JOIN nodrail.users p ON p.id = a.paused_by
       LEFT JOIN nodrail.intended_revisions r ON r.workspace_id = a.workspace_id
         AND r.project_id = a.managed_project_id AND r.environment_id = $3
       WHERE a.workspace_id = $1 AND a.external_key = $2
         AND a.archived_at IS NULL`,
      [workspaceId, agentKey, environment.id],
    ),
  );
  if (!agent) throw new AppError("NOT_FOUND");

  const installations = parseRows(
    installationRow,
    await manager.query(
      `SELECT ${installationSelect}
       FROM nodrail.installations i
       ${installationOwner}
       JOIN nodrail.agents a ON a.workspace_id = i.workspace_id
         AND (i.agent_id = a.id OR (${admittedAgent}))
       WHERE i.workspace_id = $1 AND a.id = $2 AND i.archived_at IS NULL
       ORDER BY e.slug, i.name`,
      [workspaceId, agent.id],
    ),
  );

  const observed = parseRows(
    observedRow,
    await manager.query(
      `SELECT i.name AS installation_name, o.tool_key, o.operation_key,
              o.resource_kind, o.resource_label, o.last_outcome, o.attempt_count,
              o.last_seen_at
       FROM nodrail.observed_permissions o
       JOIN nodrail.installations i
         ON i.workspace_id = o.workspace_id AND i.id = o.installation_id
       WHERE o.workspace_id = $1 AND i.agent_id = $2 AND i.environment_id = $3
       ORDER BY o.last_seen_at DESC, o.id DESC
       LIMIT 50`,
      [workspaceId, agent.id, environment.id],
    ),
  );

  const canManage = context.capabilities.has("agents:manage");
  const credentials = canManage
    ? await agentCredentials(context, agent.id)
    : [];

  return {
    key: agent.external_key,
    project: agent.managed_project_id,
    projectName: agent.project_name,
    entryAgent: agent.entry_agent,
    description: agent.description,
    access: toAccess(agent),
    installations: installations.map((row) => ({
      ...toInstallation(row),
      ...(canManage
        ? {
            credentials: credentials
              .filter((item) => item.installationId === row.installation_id)
              .map(({ installationId: _id, ...credential }) => credential),
          }
        : {}),
    })),
    tools: [...new Set(observed.map((row) => row.tool_key))].sort(),
    observedActions: observed.map((row) => ({
      installationName: row.installation_name,
      toolKey: row.tool_key,
      operationKey: row.operation_key,
      resourceKind: row.resource_kind,
      resource: row.resource_label,
      outcome: row.last_outcome as ObservedOutcome,
      attempts: row.attempt_count,
      lastSeenAt: row.last_seen_at.toISOString(),
    })),
    canManage,
  };
}

async function agentCredentials(
  { manager, workspaceId }: WorkspaceContext,
  agentId: string,
) {
  const toCredential = (
    row: z.infer<typeof credentialRow>,
  ): CredentialDto & { installationId: string } => ({
    id: row.id,
    installationId: row.installation_id,
    prefix: row.public_prefix,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  });
  return parseRows(
    credentialRow,
    await manager.query(
      `SELECT c.id, c.installation_id, c.public_prefix, c.created_at,
                  c.last_used_at, c.revoked_at
           FROM nodrail.installation_credentials c
           JOIN nodrail.installations i
             ON i.workspace_id = c.workspace_id AND i.id = c.installation_id
           WHERE c.workspace_id = $1 AND i.agent_id = $2
           ORDER BY c.created_at DESC, c.id DESC
           LIMIT 100`,
      [workspaceId, agentId],
    ),
  ).map(toCredential);
}

/** For choosing an agent in forms and filters. */
export async function listAgentOptions(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<AgentOptionDto[]> {
  const environment = await findEnvironment(context, environmentSlug);
  return context.manager.query(
    `SELECT a.external_key AS "key", i.name AS "installationName"
     FROM nodrail.agents a
     LEFT JOIN nodrail.installations i
       ON i.workspace_id = a.workspace_id AND i.agent_id = a.id
      AND i.environment_id = $2 AND i.archived_at IS NULL
     WHERE a.workspace_id = $1 AND a.archived_at IS NULL
     ORDER BY a.external_key
     LIMIT 500`,
    [context.workspaceId, environment.id],
  );
}

function installationNameFor(agentKey: string, environmentSlug: string) {
  const suffix =
    { development: "dev", production: "prod" }[environmentSlug] ??
    environmentSlug;
  return `${agentKey}-${suffix}`;
}

/** Connecting a known agent adds it to this environment. */
export async function connectAgent(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<ConnectedAgentDto> {
  requireCapability(context, "agents:manage");
  const input = parseInput(connectAgentInput, rawInput);
  const { manager, workspaceId, principal } = context;
  const environment = await findEnvironment(context, input.environmentSlug);

  let agent = await manager.findOneBy(Agent, {
    workspaceId,
    externalKey: input.agentKey,
  });
  if (agent?.archivedAt) throw new AppError("ALREADY_EXISTS");
  agent ??= await manager.save(Agent, {
    workspaceId,
    externalKey: input.agentKey,
    description: input.description,
  });

  await manager
    .createQueryBuilder()
    .insert()
    .into(AgentMember)
    .values({ workspaceId, agentId: agent.id, userId: principal.userId })
    .orIgnore()
    .execute();

  const installationName = installationNameFor(
    input.agentKey,
    environment.slug,
  );
  const installation = await manager.save(Installation, {
    workspaceId,
    agentId: agent.id,
    environmentId: environment.id,
    name: installationName,
    adapterKey: input.adapterKey,
  });
  const credential = await issueCredential(context, installation.id);

  await recordAudit(context, {
    eventType: "agent.connected",
    decisionCode: "agent_connected",
    agentId: agent.id,
    environmentId: environment.id,
    payload: { installation: installationName, adapter: input.adapterKey },
  });
  return {
    agentKey: input.agentKey,
    installationName,
    adapterKey: input.adapterKey,
    credential,
  };
}

export async function lockAgent(context: WorkspaceContext, agentKey: string) {
  const [agent]: { id: string; access_status: "active" | "paused" }[] =
    await context.manager.query(
      `SELECT id, access_status FROM nodrail.agents
       WHERE workspace_id = $1 AND external_key = $2 AND archived_at IS NULL
       FOR UPDATE`,
      [context.workspaceId, agentKey],
    );
  if (!agent) throw new AppError("NOT_FOUND");
  return agent;
}

/**
 * Applies to the whole agent, in every environment. Closes that agent's open
 * requests and no one else's. Repeating it changes nothing.
 */
export async function pauseAgent(
  context: WorkspaceContext,
  agentKey: string,
): Promise<AccessChangeDto> {
  requireCapability(context, "agents:manage");
  const agent = await lockAgent(context, agentKey);
  if (agent.access_status === "paused") return { status: "paused" };

  await context.manager.query(
    `UPDATE nodrail.agents
     SET access_status = 'paused', paused_at = clock_timestamp(), paused_by = $3,
         access_epoch = access_epoch + 1
     WHERE workspace_id = $1 AND id = $2`,
    [context.workspaceId, agent.id, context.principal.userId],
  );
  // Its requests not yet permitted are closed by the new epoch (INVALIDATED).
  await recordAudit(context, {
    eventType: "agent.paused",
    decisionCode: "agent_paused",
    agentId: agent.id,
  });
  return { status: "paused" };
}

/** Requests closed by the pause stay closed; agents ask again. */
export async function resumeAgent(
  context: WorkspaceContext,
  agentKey: string,
): Promise<AccessChangeDto> {
  requireCapability(context, "agents:manage");
  const agent = await lockAgent(context, agentKey);
  if (agent.access_status === "active") return { status: "active" };

  await context.manager.query(
    `UPDATE nodrail.agents
     SET access_status = 'active', paused_at = NULL, paused_by = NULL,
         access_epoch = access_epoch + 1
     WHERE workspace_id = $1 AND id = $2`,
    [context.workspaceId, agent.id],
  );
  await recordAudit(context, {
    eventType: "agent.resumed",
    decisionCode: "agent_resumed",
    agentId: agent.id,
  });
  return { status: "active" };
}

/** Locks the owning agent first, the same order every security step uses. */
async function lockInstallation(
  context: WorkspaceContext,
  installationId: string,
) {
  const [installation]: {
    id: string;
    agent_id: string;
    environment_id: string;
    enrollment_project_id: string | null;
  }[] = await context.manager.query(
    `SELECT i.id, i.agent_id, i.environment_id, i.enrollment_project_id FROM nodrail.installations i
       WHERE i.workspace_id = $1 AND i.id = $2 AND i.archived_at IS NULL`,
    [context.workspaceId, installationId],
  );
  if (!installation) throw new AppError("NOT_FOUND");
  await context.manager.query(
    `SELECT 1 FROM nodrail.agents
     WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [context.workspaceId, installation.agent_id],
  );
  return installation;
}

/** Replaces the secret without disturbing requests already waiting. */
export async function rotateCredential(
  context: WorkspaceContext,
  installationId: string,
): Promise<IssuedCredentialDto> {
  requireCapability(context, "agents:manage");
  const installation = await lockInstallation(context, installationId);
  const scopes = installation.enrollment_project_id
    ? await supportedHostScopes(context, {
        environmentId: installation.environment_id,
        projectId: installation.enrollment_project_id,
      })
    : RUNTIME_SCOPES;
  await setEnrollmentDisabled(context, installation, false);
  await closeCredential(context, installationId);
  const credential = await issueCredential(context, installationId, scopes);
  await recordAudit(context, {
    eventType: "credential.rotated",
    decisionCode: "credential_rotated",
    agentId: installation.agent_id,
    environmentId: installation.environment_id,
    payload: { prefix: credential.prefix },
  });
  return credential;
}

/**
 * Stops the secret working: a request it submitted can't get its permit,
 * since a permit is asked for with the credential. False when it was
 * revoked already.
 */
export async function revokeCredential(
  context: WorkspaceContext,
  installationId: string,
): Promise<{ revoked: boolean }> {
  requireCapability(context, "agents:manage");
  const installation = await lockInstallation(context, installationId);
  await setEnrollmentDisabled(context, installation, true);
  if (!(await closeCredential(context, installationId)))
    return { revoked: false };
  await recordAudit(context, {
    eventType: "credential.revoked",
    decisionCode: "credential_revoked",
    agentId: installation.agent_id,
    environmentId: installation.environment_id,
  });
  return { revoked: true };
}

async function setEnrollmentDisabled(
  context: WorkspaceContext,
  installation: Awaited<ReturnType<typeof lockInstallation>>,
  disabled: boolean,
) {
  if (installation.enrollment_project_id)
    await context.manager.query(
      `UPDATE nodrail.installations
       SET enrollment_disabled_at = CASE WHEN $3 THEN COALESCE(enrollment_disabled_at, clock_timestamp()) END
       WHERE workspace_id = $1 AND id = $2`,
      [context.workspaceId, installation.id, disabled],
    );
}
