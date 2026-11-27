import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  requireReviewedRepository,
  type PolicyWriteContext,
} from "./repository";
import { sourceColumns, type VersionOrigin } from "./managed";
import {
  conditionLabel,
  effectLabels,
  operationLabel,
  resourceLabel,
  currentRuleInput,
  type Condition,
  type Effect,
  type ResourceScope,
  type RuleChangeResultDto,
  type RuleDetailDto,
  type RuleDto,
  type RuleInput,
  type RuleListDto,
} from "@/contracts/v1/policies";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { ActivePolicy, PolicyRule, PolicyVersion } from "@/server/db/entities";
import { recordAudit } from "@/server/modules/audit";
import { findEnvironment } from "@/server/modules/workspaces";
import type { RunPolicy } from "@/server/modules/runs/history";

export const MAX_RULES_PER_ENVIRONMENT = 500;

const ruleRow = z.object({
  logical_rule_id: z.uuid(),
  rule_revision: z.number(),
  is_current: z.boolean(),
  name: z.string(),
  external_key: z.string().nullable(),
  installation_name: z.string().nullable(),
  tool_key: z.string(),
  operation_key: z.string(),
  effect: z.custom<Effect>(),
  resource_scope: z.custom<ResourceScope>(),
  conditions: z.custom<Condition[]>(),
  expires_at: z.date().nullable(),
  updated_at: z.date(),
  updated_by_name: z.string(),
});
type RuleRow = z.infer<typeof ruleRow>;

const ruleSelect = `
  r.logical_rule_id, r.rule_revision,
  (a.policy_version_id = r.policy_version_id) AS is_current,
  r.name, ag.external_key, i.name AS installation_name, r.tool_key,
  r.operation_key, r.effect, r.resource_scope, r.conditions, r.expires_at,
  r.updated_at, u.display_name AS updated_by_name`;

const ruleJoins = `
  FROM nodrail.policy_rules r
  JOIN nodrail.policy_versions v
    ON v.workspace_id = r.workspace_id AND v.id = r.policy_version_id
  JOIN nodrail.active_policies a
    ON a.workspace_id = r.workspace_id AND a.environment_id = r.environment_id
  JOIN nodrail.users u ON u.id = r.updated_by
  LEFT JOIN nodrail.agents ag
    ON ag.workspace_id = r.workspace_id AND ag.id = r.agent_id
  LEFT JOIN nodrail.installations i
    ON i.workspace_id = r.workspace_id AND i.id = r.installation_id`;

function toRule(row: RuleRow): RuleDto {
  const expired =
    row.expires_at !== null && row.expires_at.getTime() <= Date.now();
  return {
    logicalRuleId: row.logical_rule_id,
    ruleRevision: row.rule_revision,
    name: row.name,
    effect: row.effect,
    agentKey: row.external_key,
    installationName: row.installation_name,
    toolKey: row.tool_key,
    operationKey: row.operation_key,
    resource: row.resource_scope,
    conditions: row.conditions,
    expiresAt: row.expires_at?.toISOString() ?? null,
    status: !row.is_current ? "revoked" : expired ? "expired" : "active",
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by_name,
  };
}

export async function listRules(
  context: WorkspaceContext,
  environmentSlug: string,
): Promise<RuleListDto> {
  const { manager, workspaceId } = context;
  const environment = await findEnvironment(context, environmentSlug);
  const rows = parseRows(
    ruleRow,
    await manager.query(
      `SELECT DISTINCT ON (r.logical_rule_id) ${ruleSelect}
       ${ruleJoins}
       WHERE r.workspace_id = $1 AND r.environment_id = $2
       ORDER BY r.logical_rule_id, v.revision DESC
       LIMIT ${MAX_RULES_PER_ENVIRONMENT * 2}`,
      [workspaceId, environment.id],
    ),
  );
  const [active] = parseRows(
    z.object({ revision: z.number() }),
    await manager.query(
      `SELECT v.revision FROM nodrail.active_policies a
       JOIN nodrail.policy_versions v
         ON v.workspace_id = a.workspace_id AND v.id = a.policy_version_id
       WHERE a.workspace_id = $1 AND a.environment_id = $2`,
      [workspaceId, environment.id],
    ),
  );
  return {
    rules: rows
      .map(toRule)
      .sort(
        (a, b) =>
          Number(b.status === "active") - Number(a.status === "active") ||
          b.updatedAt.localeCompare(a.updatedAt),
      ),
    policyRevision: active?.revision ?? 1,
  };
}

/** A rule and how it changed. Hidden from people who cannot see its agent. */
export async function getRule(
  context: WorkspaceContext,
  environmentSlug: string,
  logicalRuleId: string,
): Promise<RuleDetailDto> {
  const { manager, workspaceId } = context;
  if (!z.uuid().safeParse(logicalRuleId).success)
    throw new AppError("NOT_FOUND");
  const environment = await findEnvironment(context, environmentSlug);
  const revisions = parseRows(
    ruleRow.extend({ last_revision: z.number() }),
    await manager.query(
      `SELECT DISTINCT ON (r.rule_revision) ${ruleSelect},
              max(v.revision) OVER (PARTITION BY r.logical_rule_id) AS last_revision
       ${ruleJoins}
       WHERE r.workspace_id = $1 AND r.environment_id = $2
         AND r.logical_rule_id = $3
       ORDER BY r.rule_revision DESC, v.revision DESC`,
      [workspaceId, environment.id, logicalRuleId],
    ),
  );
  const [latest] = revisions;
  if (!latest) throw new AppError("NOT_FOUND");

  const [revokedBy] = latest.is_current
    ? []
    : parseRows(
        z.object({ published_at: z.date(), display_name: z.string() }),
        await manager.query(
          `SELECT v.published_at, u.display_name
           FROM nodrail.policy_versions v
           JOIN nodrail.users u ON u.id = v.published_by
           WHERE v.workspace_id = $1 AND v.environment_id = $2 AND v.revision = $3`,
          [workspaceId, environment.id, latest.last_revision + 1],
        ),
      );

  return {
    ...toRule(latest),
    history: revisions.map((row) => {
      const rule = toRule(row);
      return {
        revision: rule.ruleRevision,
        name: rule.name,
        summary: [
          effectLabels[rule.effect],
          operationLabel(rule),
          resourceLabel(rule.resource),
          ...rule.conditions.map(conditionLabel),
        ].join(" · "),
        updatedAt: rule.updatedAt,
        updatedBy: rule.updatedBy,
      };
    }),
    revoked: revokedBy
      ? {
          at: revokedBy.published_at.toISOString(),
          by: revokedBy.display_name,
        }
      : null,
  };
}

/** A rule's agent and installation by id; INVALID_INPUT if either is gone. */
export async function resolveScope(
  context: WorkspaceContext,
  environmentId: string,
  rule: Pick<RuleInput, "agentKey" | "installationName">,
) {
  const { manager, workspaceId } = context;
  let agentId: string | null = null;
  if (rule.agentKey) {
    const [agent]: { id: string }[] = await manager.query(
      `SELECT id FROM nodrail.agents
       WHERE workspace_id = $1 AND external_key = $2 AND archived_at IS NULL`,
      [workspaceId, rule.agentKey],
    );
    if (!agent) throw new AppError("INVALID_INPUT");
    agentId = agent.id;
  }
  let installationId: string | null = null;
  if (rule.installationName) {
    const [installation]: { id: string }[] = await manager.query(
      `SELECT id FROM nodrail.installations
       WHERE workspace_id = $1 AND name = $2 AND environment_id = $3
         AND agent_id = $4 AND archived_at IS NULL`,
      [workspaceId, rule.installationName, environmentId, agentId],
    );
    if (!installation) throw new AppError("INVALID_INPUT");
    installationId = installation.id;
  }
  return { agentId, installationId };
}

type Change =
  | { kind: "create"; rule: RuleInput }
  | {
      kind: "update";
      logicalRuleId: string;
      expectedRuleRevision: number;
      rule: RuleInput;
    }
  | { kind: "revoke"; logicalRuleId: string; expectedRuleRevision: number };

export type WrittenRule = Pick<
  PolicyRule,
  | "logicalRuleId"
  | "ruleRevision"
  | "name"
  | "agentId"
  | "installationId"
  | "toolKey"
  | "operationKey"
  | "effect"
  | "expiresAt"
  | "updatedBy"
  | "updatedAt"
> & { resourceScope: object; conditions: object };

/**
 * One new immutable version: rules carried over unchanged plus rules written
 * now. Every publication goes through here. Call it holding the environment lock.
 */
export async function publishSnapshot(
  context: WorkspaceContext,
  snapshot: {
    environmentId: string;
    revision: number;
    carried: PolicyRule[];
    written: WrittenRule[];
    /** Gates and budgets live with the version, so each one names them. */
    runPolicy: RunPolicy | null;
    /** The project, lock and file apply published it from. */
    origin?: VersionOrigin;
  },
) {
  const { manager, workspaceId, principal } = context;
  const { environmentId, revision, carried, written } = snapshot;
  const versionId = randomUUID();
  await manager.insert(PolicyVersion, {
    id: versionId,
    workspaceId,
    environmentId,
    revision,
    publishedBy: principal.userId,
    runPolicy: snapshot.runPolicy,
    ...sourceColumns(snapshot.origin),
  });
  const location = { workspaceId, environmentId, policyVersionId: versionId };
  const rows = [
    ...carried.map((rule) => ({
      ...location,
      logicalRuleId: rule.logicalRuleId,
      ruleRevision: rule.ruleRevision,
      name: rule.name,
      agentId: rule.agentId,
      installationId: rule.installationId,
      toolKey: rule.toolKey,
      operationKey: rule.operationKey,
      operationSchemaVersion: rule.operationSchemaVersion,
      effect: rule.effect,
      resourceScope: rule.resourceScope as object,
      conditions: rule.conditions as object,
      expiresAt: rule.expiresAt,
      updatedBy: rule.updatedBy,
      updatedAt: rule.updatedAt,
    })),
    ...written.map((rule) => ({ ...rule, ...location })),
  ];
  if (rows.length) await manager.insert(PolicyRule, rows);
  await manager.update(
    ActivePolicy,
    { workspaceId, environmentId },
    { policyVersionId: versionId, activatedAt: new Date() },
  );
  return versionId;
}

/**
 * Callers change one rule. The new snapshot is built here under the environment
 * lock, so edits to different rules never conflict and history never changes.
 */
async function applyChange(
  context: PolicyWriteContext,
  environmentSlug: string,
  change: Change,
): Promise<RuleChangeResultDto> {
  requireCapability(context, "policies:write");
  const { manager, workspaceId, principal } = context;
  const { id: environmentId } = await findEnvironment(context, environmentSlug);

  await manager.query(
    `SELECT 1 FROM nodrail.environments
     WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, environmentId],
  );
  await requireReviewedRepository(context, environmentId);
  const active = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId,
  });
  const current = await manager.findBy(PolicyRule, {
    workspaceId,
    policyVersionId: active.policyVersionId,
  });
  const { revision, runPolicy } = await manager.findOneByOrFail(PolicyVersion, {
    workspaceId,
    id: active.policyVersionId,
  });

  const logicalRuleId =
    change.kind === "create" ? randomUUID() : change.logicalRuleId;
  const existing = current.find((rule) => rule.logicalRuleId === logicalRuleId);
  if (change.kind !== "create") {
    if (!existing) throw new AppError("NOT_FOUND");
    if (existing.ruleRevision !== change.expectedRuleRevision)
      throw new AppError("RULE_CHANGED");
  } else if (current.length >= MAX_RULES_PER_ENVIRONMENT) {
    throw new AppError(
      "RULE_LIMIT_REACHED",
      `This environment has reached its limit of ${MAX_RULES_PER_ENVIRONMENT} rules. Revoke an existing rule before creating another.`,
    );
  }

  const replacement =
    change.kind === "revoke"
      ? null
      : {
          ...(await resolveScope(context, environmentId, change.rule)),
          name: change.rule.name,
          toolKey: change.rule.toolKey,
          operationKey: change.rule.operationKey,
          effect: change.rule.effect,
          resourceScope: change.rule.resource,
          conditions: change.rule.conditions,
          expiresAt: change.rule.expiresAt
            ? new Date(change.rule.expiresAt)
            : null,
          ruleRevision: (existing?.ruleRevision ?? 0) + 1,
          updatedBy: principal.userId,
          updatedAt: new Date(),
        };

  const versionId = await publishSnapshot(context, {
    environmentId,
    revision: revision + 1,
    carried: current.filter((rule) => rule.logicalRuleId !== logicalRuleId),
    written: replacement ? [{ ...replacement, logicalRuleId }] : [],
    runPolicy: runPolicy as RunPolicy | null,
  });
  await recordAudit(context, {
    eventType: "policy.published",
    decisionCode: `rule_${change.kind}`,
    environmentId,
    agentId: (replacement ?? existing)?.agentId ?? undefined,
    policyVersionId: versionId,
    matchedLogicalRuleId: logicalRuleId,
    payload: { revision: revision + 1 },
  });

  return { policyRevision: revision + 1, logicalRuleId };
}

export function createRule(
  context: PolicyWriteContext,
  environmentSlug: string,
  rawRule: unknown,
) {
  requireCapability(context, "policies:write");
  return applyChange(context, environmentSlug, {
    kind: "create",
    rule: parseInput(currentRuleInput, rawRule),
  });
}

export function updateRule(
  context: PolicyWriteContext,
  environmentSlug: string,
  logicalRuleId: string,
  expectedRuleRevision: number,
  rawRule: unknown,
) {
  requireCapability(context, "policies:write");
  return applyChange(context, environmentSlug, {
    kind: "update",
    logicalRuleId,
    expectedRuleRevision,
    rule: parseInput(currentRuleInput, rawRule),
  });
}

export function revokeRule(
  context: PolicyWriteContext,
  environmentSlug: string,
  logicalRuleId: string,
  expectedRuleRevision: number,
) {
  return applyChange(context, environmentSlug, {
    kind: "revoke",
    logicalRuleId,
    expectedRuleRevision,
  });
}
