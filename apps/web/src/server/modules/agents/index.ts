import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  REPORTING_WINDOW_MINUTES,
  connectAgentInput,
  type AccessChangeDto,
  type AgentAccessDto,
  type AgentDetailDto,
  type AgentOptionDto,
  type AgentListDto,
  type ConnectedAgentDto,
  type CredentialDto,
  type InstallationDto,
  type IssuedCredentialDto,
  type ObservedOutcome,
  type Reporting,
} from "@/contracts/v1/agents";
import type { AgentCountsDto } from "@/contracts/v1/activity";
import {
  AppError,
  decodeCursor,
  encodeCursor,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import {
  Agent,
  AgentMember,
  Installation,
  InstallationCredential,
} from "@/server/db/entities";
import { recordAudit } from "@/server/modules/audit";
import { findEnvironment } from "@/server/modules/workspaces";
import { digestSecret, newSecret } from "@/server/security/secrets";
import { RUNTIME_SCOPES } from "@/server/db/runtime-scopes";

const PAGE_SIZE = 50;

function reportingFor(lastSeenAt: Date | null, now = Date.now()): Reporting {
  if (!lastSeenAt) return "never_reported";
  return now - lastSeenAt.getTime() <= REPORTING_WINDOW_MINUTES * 60_000
    ? "reporting"
    : "stale";
}

const accessColumns = {
  access_status: z.enum(["active", "paused"]),
  paused_at: z.date().nullable(),
  paused_by_name: z.string().nullable(),
};

const installationColumns = {
  installation_id: z.uuid(),
  installation_name: z.string(),
  environment_slug: z.string(),
  environment_name: z.string(),
  adapter_key: z.string(),
  adapter_version: z.string().nullable(),
  compatibility: z.enum(["unverified", "verified"]),
  last_seen_at: z.date().nullable(),
};

const accessRow = z.object(accessColumns);
const installationRow = z.object(installationColumns);

function toAccess(row: z.infer<typeof accessRow>): AgentAccessDto {
  return {
    status: row.access_status,
    pausedAt: row.paused_at?.toISOString() ?? null,
    pausedBy: row.paused_by_name,
  };
}

function toInstallation(row: z.infer<typeof installationRow>): InstallationDto {
  return {
    id: row.installation_id,
    name: row.installation_name,
    environment: { slug: row.environment_slug, name: row.environment_name },
    adapterKey: row.adapter_key,
    adapterVersion: row.adapter_version,
    compatibility: row.compatibility,
    reporting: reportingFor(row.last_seen_at),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
  };
}

const installationSelect = `
  i.id AS installation_id, i.name AS installation_name,
  e.slug AS environment_slug, e.name AS environment_name,
  i.adapter_key, i.adapter_version, i.compatibility, i.last_seen_at`;

const listRow = z.object({
  id: z.uuid(),
  external_key: z.string(),
  description: z.string().nullable(),
  cursor_at: z.string(),
  tools: z.array(z.string()),
  ...accessColumns,
  ...installationColumns,
});

const countsRow = z.object({
  connected: z.number(),
  reporting: z.number(),
  paused: z.number(),
});

/** The figures shown on Agents and Overview. Limited to who may see them. */
export async function countAgents(
  context: WorkspaceContext,
  environmentId: string,
): Promise<AgentCountsDto> {
  const [counts] = parseRows(
    countsRow,
    await context.manager.query(
      `SELECT count(*)::int AS connected,
              count(*) FILTER (
                WHERE i.last_seen_at > clock_timestamp() - make_interval(mins => $3)
              )::int AS reporting,
              count(*) FILTER (WHERE a.access_status = 'paused')::int AS paused
       FROM nodrail.installations i
       JOIN nodrail.agents a
         ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
       WHERE i.workspace_id = $1 AND i.environment_id = $2
         AND i.archived_at IS NULL AND a.archived_at IS NULL`,
      [context.workspaceId, environmentId, REPORTING_WINDOW_MINUTES],
    ),
  );
  return counts ?? { connected: 0, reporting: 0, paused: 0 };
}

export async function listAgents(
  context: WorkspaceContext,
  environmentSlug: string,
  cursorValue?: string,
): Promise<AgentListDto> {
  const { manager, workspaceId } = context;
  const environment = await findEnvironment(context, environmentSlug);
  const cursor = decodeCursor(cursorValue);

  const rows = parseRows(
    listRow,
    await manager.query(
      `SELECT a.id, a.external_key, a.description, a.access_status, a.paused_at,
              p.display_name AS paused_by_name, a.created_at::text AS cursor_at,
              ${installationSelect},
              ARRAY(SELECT DISTINCT o.tool_key FROM nodrail.observed_permissions o
                    WHERE o.workspace_id = i.workspace_id
                      AND o.installation_id = i.id
                    ORDER BY o.tool_key) AS tools
       FROM nodrail.installations i
       JOIN nodrail.agents a
         ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
       JOIN nodrail.environments e
         ON e.workspace_id = i.workspace_id AND e.id = i.environment_id
       LEFT JOIN nodrail.users p ON p.id = a.paused_by
       WHERE i.workspace_id = $1 AND i.environment_id = $2
         AND i.archived_at IS NULL AND a.archived_at IS NULL
         AND ($3::timestamptz IS NULL
              OR (a.created_at, a.id) < ($3::timestamptz, $4::uuid))
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $5`,
      [workspaceId, environment.id, cursor.at, cursor.id, PAGE_SIZE + 1],
    ),
  );

  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      key: row.external_key,
      description: row.description,
      access: toAccess(row),
      installation: toInstallation(row),
      tools: row.tools,
    })),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? encodeCursor(last.cursor_at, last.id)
        : null,
    summary: await countAgents(context, environment.id),
  };
}

const detailRow = z.object({
  id: z.uuid(),
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
      `SELECT a.id, a.external_key, a.description, a.access_status, a.paused_at,
              p.display_name AS paused_by_name
       FROM nodrail.agents a
       LEFT JOIN nodrail.users p ON p.id = a.paused_by
       WHERE a.workspace_id = $1 AND a.external_key = $2
         AND a.archived_at IS NULL`,
      [workspaceId, agentKey],
    ),
  );
  if (!agent) throw new AppError("NOT_FOUND");

  const installations = parseRows(
    installationRow,
    await manager.query(
      `SELECT ${installationSelect}
       FROM nodrail.installations i
       JOIN nodrail.environments e
         ON e.workspace_id = i.workspace_id AND e.id = i.environment_id
       WHERE i.workspace_id = $1 AND i.agent_id = $2 AND i.archived_at IS NULL
       ORDER BY e.slug`,
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
    ? parseRows(
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
          [workspaceId, agent.id],
        ),
      )
    : [];
  const toCredential = (row: z.infer<typeof credentialRow>): CredentialDto => ({
    id: row.id,
    prefix: row.public_prefix,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  });

  return {
    key: agent.external_key,
    description: agent.description,
    access: toAccess(agent),
    installations: installations.map((row) => ({
      ...toInstallation(row),
      ...(canManage
        ? {
            credentials: credentials
              .filter((item) => item.installation_id === row.installation_id)
              .map(toCredential),
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

/** The secret exists only in this response. Only its digest is stored. */
async function issueCredential(
  context: WorkspaceContext,
  installationId: string,
): Promise<IssuedCredentialDto> {
  const prefix = randomBytes(6).toString("hex");
  const secret = newSecret();
  const credential = await context.manager.save(InstallationCredential, {
    workspaceId: context.workspaceId,
    installationId,
    publicPrefix: prefix,
    secretDigest: digestSecret(secret),
    scopes: RUNTIME_SCOPES,
    createdBy: context.principal.userId,
  });
  return { id: credential.id, prefix, secret: `ndr_${prefix}_${secret}` };
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
  }[] = await context.manager.query(
    `SELECT i.id, i.agent_id, i.environment_id FROM nodrail.installations i
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

async function closeCredential(
  context: WorkspaceContext,
  installationId: string,
) {
  const { manager, workspaceId, principal } = context;
  const [closed]: [{ id: string }[], number] = await manager.query(
    `UPDATE nodrail.installation_credentials
     SET revoked_at = clock_timestamp(), revoked_by = $3
     WHERE workspace_id = $1 AND installation_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [workspaceId, installationId, principal.userId],
  );
  return closed.length > 0;
}

/** Replaces the secret without disturbing requests already waiting. */
export async function rotateCredential(
  context: WorkspaceContext,
  installationId: string,
): Promise<IssuedCredentialDto> {
  requireCapability(context, "agents:manage");
  const installation = await lockInstallation(context, installationId);
  await closeCredential(context, installationId);
  const credential = await issueCredential(context, installationId);
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
