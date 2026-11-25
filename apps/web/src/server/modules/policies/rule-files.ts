import "server-only";
import { createHash } from "node:crypto";
import type { PolicyDocument, PolicyGate } from "@nodrail/policy-engine";
import { fingerprint } from "@nodrail/policy-engine/protocol";
import {
  compilePolicies,
  type CompileResult,
  type PolicyIssue,
} from "@nodrail/policy-engine/yaml";
import { z } from "zod";
import {
  POLICY_FILE_MAX_BYTES,
  type PolicyFilePreviewDto,
  type PolicyFileResultDto,
} from "@/contracts/v1/policies";
import {
  AppError,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { originOf, type Previewed } from "./managed";
import { publishPlanned } from "./publish";
import { ActivePolicy, PolicyRule, PolicyVersion } from "@/server/db/entities";
import { findEnvironment } from "@/server/modules/workspaces";
import {
  toPolicyRule,
  versionDocument,
  type RunPolicy,
} from "@/server/modules/runs/history";
import { contractWarnings, fileOf, inputShapeNames } from "./contract-file";
import {
  planRunPolicy,
  resolveNames,
  type Issue,
  type Targets,
} from "./run-policy";
import type { WrittenRule } from "./index";

const FILE_NAME = "rules.yaml";

/** Bind the file to its preview environment and normalize form line endings. */
const fileDigest = (environmentId: string, text: unknown) =>
  fingerprint({
    environmentId,
    yaml: typeof text === "string" ? text.replace(/\r\n?/g, "\n") : null,
  });

const toIssue = ({ line, column, message }: PolicyIssue) => ({
  line,
  column,
  message,
});

/**
 * A rule's identity comes from the file. Exported rules carry their real id; a
 * readable id always maps to the same rule, so applying a file twice changes nothing.
 */
function logicalIdFor(environmentId: string, id: string) {
  if (z.uuid().safeParse(id).success) return id;
  const hex = createHash("sha256")
    .update(`${environmentId}\n${id}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const contentOf = (
  rule: {
    name: string;
    agentId: string | null;
    installationId: string | null;
    toolKey: string;
    operationKey: string;
    effect: string;
    resourceScope: unknown;
    conditions: unknown;
    expiresAt: Date | null;
  },
  where?: unknown,
) =>
  fingerprint({
    name: rule.name,
    agentId: rule.agentId,
    installationId: rule.installationId,
    toolKey: rule.toolKey,
    operationKey: rule.operationKey,
    effect: rule.effect,
    resourceScope: rule.resourceScope,
    conditions: rule.conditions,
    expiresAt: rule.expiresAt?.toISOString() ?? null,
    // Only a rule with a where names one, so other rules keep their digest.
    ...(where ? { where } : {}),
  });

async function targets(context: WorkspaceContext, environmentId: string) {
  const { manager, workspaceId } = context;
  const agents: { id: string; external_key: string }[] = await manager.query(
    `SELECT id, external_key FROM nodrail.agents
     WHERE workspace_id = $1 AND archived_at IS NULL`,
    [workspaceId],
  );
  const installations: { id: string; name: string; agent_id: string }[] =
    await manager.query(
      `SELECT id, name, agent_id FROM nodrail.installations
       WHERE workspace_id = $1 AND environment_id = $2 AND archived_at IS NULL`,
      [workspaceId, environmentId],
    );
  return {
    agents: new Map(agents.map((row) => [row.external_key, row.id])),
    installations: new Map(installations.map((row) => [row.name, row])),
  };
}

/** The compiled file, or every reason it can't be imported. */
function compileFile(rawText: string) {
  const result = compilePolicies([{ name: FILE_NAME, text: rawText }]);
  const warnings = result.warnings.map(toIssue);
  if (!result.ok)
    return { warnings, refused: result.issues.map(toIssue), compiled: null };
  return { warnings, refused: [], compiled: result };
}

/** The live version, and the next revision any rule would continue from. */
export async function livePolicy(
  context: WorkspaceContext,
  environmentId: string,
) {
  const { manager, workspaceId } = context;
  const active = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId,
  });
  const version = await manager.findOneByOrFail(PolicyVersion, {
    workspaceId,
    id: active.policyVersionId,
  });
  const rules = await manager.findBy(PolicyRule, {
    workspaceId,
    policyVersionId: active.policyVersionId,
  });
  // A rule that comes back continues its history.
  const past: { logical_rule_id: string; revision: number }[] =
    await manager.query(
      `SELECT logical_rule_id, MAX(rule_revision)::int AS revision
       FROM nodrail.policy_rules
       WHERE workspace_id = $1 AND environment_id = $2
       GROUP BY logical_rule_id`,
      [workspaceId, environmentId],
    );
  return {
    revision: version.revision,
    runPolicy: version.runPolicy as RunPolicy | null,
    rules,
    lastRevision: new Map(
      past.map((row) => [row.logical_rule_id, row.revision]),
    ),
  };
}

/** Each rule of the file: carried over unchanged, or written as a new revision. */
function planRules(
  context: WorkspaceContext,
  compiled: Extract<CompileResult, { ok: true }>,
  where: { environmentId: string; found: Targets },
  live: Awaited<ReturnType<typeof livePolicy>>,
) {
  const byId = new Map(live.rules.map((rule) => [rule.logicalRuleId, rule]));
  const planned = {
    issues: [] as Issue[],
    carried: [] as PolicyRule[],
    written: [] as WrittenRule[],
    added: [] as string[],
    changed: [] as string[],
    removed: [] as string[],
  };
  const kept = new Set<string>();
  compiled.document.rules.forEach((rule, index) => {
    const line = compiled.rules[index]?.source.line ?? 1;
    const names = resolveNames(where.found, rule, line, planned.issues);
    const logicalRuleId = logicalIdFor(where.environmentId, rule.id);
    kept.add(logicalRuleId);
    const existing = byId.get(logicalRuleId);
    const content = {
      name: rule.name,
      ...names,
      toolKey: rule.toolKey,
      operationKey: rule.operationKey,
      effect: rule.effect,
      resourceScope: rule.resource,
      conditions: rule.conditions,
      expiresAt: rule.expiresAt ? new Date(rule.expiresAt) : null,
    };
    const conditions = "where" in rule ? rule.where : undefined;
    const was = live.runPolicy?.where?.[logicalRuleId];
    if (
      existing &&
      contentOf(existing, was) === contentOf(content, conditions)
    ) {
      planned.carried.push(existing);
      return;
    }
    (existing ? planned.changed : planned.added).push(rule.name);
    planned.written.push({
      ...content,
      logicalRuleId,
      ruleRevision: (live.lastRevision.get(logicalRuleId) ?? 0) + 1,
      updatedBy: context.principal.userId,
      updatedAt: new Date(),
    });
  });
  for (const rule of live.rules)
    if (!kept.has(rule.logicalRuleId)) planned.removed.push(rule.name);
  return planned;
}

/** Works out what a file would do. Shared by preview and apply. */
export async function plan(
  context: WorkspaceContext,
  environmentId: string,
  rawText: unknown,
) {
  const live = await livePolicy(context, environmentId);
  const empty = {
    revision: live.revision,
    issues: [] as Issue[],
    warnings: [] as Issue[],
    carried: [] as PolicyRule[],
    written: [] as WrittenRule[],
    runPolicy: null as RunPolicy | null,
    inputShapes: new Map<string, string>(),
    added: [] as string[],
    changed: [] as string[],
    removed: [] as string[],
  };
  if (
    typeof rawText !== "string" ||
    Buffer.byteLength(rawText) > POLICY_FILE_MAX_BYTES
  )
    return {
      ...empty,
      issues: [
        { line: 1, column: 1, message: "The file must be under 256 KB." },
      ],
    };

  const { compiled, warnings, refused } = compileFile(rawText);
  if (!compiled) return { ...empty, warnings, issues: refused };

  const found = await targets(context, environmentId);
  const rules = planRules(context, compiled, { environmentId, found }, live);
  const run = planRunPolicy(
    compiled.document,
    (id) => logicalIdFor(environmentId, id),
    found,
    live.runPolicy,
  );
  const inputShapes = inputShapeNames(rawText);
  const lines = new Map(compiled.rules.map((r) => [r.name, r.source.line]));
  return {
    ...empty,
    ...rules,
    inputShapes,
    warnings: [
      ...warnings,
      ...contractWarnings(compiled.document, rawText, lines),
    ],
    issues: [...rules.issues, ...run.issues],
    runPolicy: run.runPolicy,
    added: [...rules.added, ...run.added],
    changed: [...rules.changed, ...run.changed],
    removed: [...rules.removed, ...run.removed],
  };
}

export async function previewPolicyFile(
  context: WorkspaceContext,
  environmentSlug: string,
  text: unknown,
): Promise<PolicyFilePreviewDto> {
  requireCapability(context, "policies:write");
  const { id } = await findEnvironment(context, environmentSlug);
  const planned = await plan(context, id, text);
  return {
    issues: planned.issues,
    warnings: planned.warnings,
    policyRevision: planned.revision,
    fileDigest: fileDigest(id, text),
    added: planned.added,
    changed: planned.changed,
    removed: planned.removed,
    unchanged: planned.carried.length,
  };
}

/**
 * The environment, locked until the transaction ends, for someone who manages
 * its policies: two publishes never start from the same version.
 */
export async function lockEnvironment(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  requireCapability(context, "policies:write");
  const { manager, workspaceId } = context;
  const { id } = await findEnvironment(context, environmentSlug);
  await manager.query(
    `SELECT 1 FROM nodrail.environments
     WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, id],
  );
  return id;
}

/**
 * Makes the environment match the file, as one new version: rules not in the
 * file are removed. Publishes exactly what was previewed, or refuses.
 */
export async function applyPolicyFile(
  context: WorkspaceContext,
  environmentSlug: string,
  text: unknown,
  expected: Previewed,
): Promise<PolicyFileResultDto> {
  const environmentId = await lockEnvironment(context, environmentSlug);
  if (fileDigest(environmentId, text) !== expected.fileDigest)
    throw new AppError("RULE_CHANGED");
  const planned = await plan(context, environmentId, text);
  if (planned.issues.length) throw new AppError("INVALID_INPUT");
  if (planned.revision !== expected.revision)
    throw new AppError("RULE_CHANGED");
  return publishPlanned(
    context,
    environmentId,
    planned,
    originOf(expected, text),
  );
}

/** The live version with agents and installations by name, as a file names them. */
export async function namedDocument(
  context: WorkspaceContext,
  environmentId: string,
): Promise<PolicyDocument> {
  const { manager, workspaceId } = context;
  const active = await manager.findOneByOrFail(ActivePolicy, {
    workspaceId,
    environmentId,
  });
  const document = await versionDocument(context, active.policyVersionId);
  // Archived too: dropping a rule's agent would make it apply to every agent.
  const agents: { id: string; external_key: string }[] = await manager.query(
    `SELECT id, external_key FROM nodrail.agents WHERE workspace_id = $1`,
    [workspaceId],
  );
  const installations: { id: string; name: string }[] = await manager.query(
    `SELECT id, name FROM nodrail.installations WHERE workspace_id = $1`,
    [workspaceId],
  );
  const agentKey = new Map(agents.map((row) => [row.id, row.external_key]));
  const installationName = new Map(
    installations.map((row) => [row.id, row.name]),
  );
  // Stored by id; the file names them.
  const named = <T extends ReturnType<typeof toPolicyRule>>(entry: T): T => ({
    ...entry,
    agentKey: entry.agentKey ? (agentKey.get(entry.agentKey) ?? null) : null,
    installationName: entry.installationName
      ? (installationName.get(entry.installationName) ?? null)
      : null,
  });
  if (document.version === 1)
    return { ...document, rules: document.rules.map(named) };
  const gates = (document.gates as PolicyGate[]).map(named);
  return {
    ...document,
    rules: document.rules.map(named),
    gates,
  } as PolicyDocument;
}

/**
 * The active rules, gates and budgets as a file that applies back to them, as
 * the Edit as YAML page shows it. Anyone who can see the rule list can read
 * it, limited by the database to the same rules; publishing takes policies:write.
 */
export async function readPolicyFile(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  requireCapability(context, "workspace:read");
  const { id: environmentId } = await findEnvironment(context, environmentSlug);
  // A version 4 policy is refused plainly (409); see fileOf.
  return fileOf(await namedDocument(context, environmentId));
}

/** The same file as a download, for people who manage the rules. */
export async function exportPolicyFile(
  context: WorkspaceContext,
  environmentSlug: string,
) {
  requireCapability(context, "policies:write");
  return readPolicyFile(context, environmentSlug);
}
