import "server-only";
import type { Declarations, ProjectApply } from "@/contracts/v1/project-apply";
import { authorizeProject } from "@/server/modules/agents/project-access";
import { lockEnvironment } from "./environment-lock";
import { fileDigest } from "./policy-file-digest";
import { projectPinsCurrent } from "./project-pin-status";
import { validateProjectBindings } from "./project-bindings";
import { policyOwner, takeoverHosts } from "./project-owner";
import { projectAgentTargets } from "@/server/modules/agents/project-agents";
import { fingerprint } from "@nodrail/sdk/protocol";
import {
  compilePolicies,
  type CompileResult,
  type PolicyIssue,
} from "@nodrail/sdk/yaml";
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
import { removedRules } from "./removed-rules";
import { logicalIdFor } from "./logical-id";
import {
  requireReviewedRepository,
  type PolicyWriteContext,
} from "./repository";
import { originOf, type Previewed } from "./managed";
import { projectPreviewChanges } from "./project-preview-changes";
import { policyCounts, publishPlanned } from "./publish";
import { ActivePolicy, PolicyRule, PolicyVersion } from "@/server/db/entities";
import { findEnvironment } from "@/server/modules/workspaces";
import type { RunPolicy } from "@/server/modules/runs/history";
import { contractWarnings, inputShapeNames } from "./contract-file";
import {
  planRunPolicy,
  resolveNames,
  type Issue,
  type Targets,
} from "./run-policy";
import type { WrittenRule } from "./index";

const FILE_NAME = "rules.yaml";

const toIssue = ({ line, column, message }: PolicyIssue) => ({
  line,
  column,
  message,
});

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

async function targets(
  context: WorkspaceContext,
  environmentId: string,
  declared?: Declarations,
) {
  const { manager, workspaceId } = context;
  const agents = await projectAgentTargets(context, declared);
  const installations: { id: string; name: string; agent_id: string }[] =
    await manager.query(
      `SELECT id, name, agent_id FROM nodrail.installations
       WHERE workspace_id = $1 AND environment_id = $2 AND archived_at IS NULL`,
      [workspaceId, environmentId],
    );
  return {
    ...agents,
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
    sourceText: version.sourceText,
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
  return { ...planned, ...removedRules(live, where.environmentId, kept) };
}

/** Works out what a file would do. Shared by preview and apply. */
export async function plan(
  context: WorkspaceContext,
  environmentId: string,
  rawText: unknown,
  declarations?: Declarations,
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
    catalogRemoved: [] as string[],
    agentsAdded: [] as string[],
    agentsChanged: [] as string[],
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

  const found = await targets(context, environmentId, declarations);
  const rules = planRules(context, compiled, { environmentId, found }, live);
  const run = planRunPolicy(
    compiled.document,
    (id) => logicalIdFor(environmentId, id),
    { found, gateLines: compiled.gates.map((gate) => gate.source.line) },
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
    issues: [
      ...new Map(
        [...rules.issues, ...run.issues, ...found.issues].map((issue) => [
          `${issue.line}:${issue.column}:${issue.message}`,
          issue,
        ]),
      ).values(),
    ].sort((a, b) => a.line - b.line || a.column - b.column),
    agentsAdded: found.added,
    agentsChanged: found.changed,
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
  project?: {
    declarations?: Declarations;
    intended?: ProjectApply["intended"];
  },
): Promise<PolicyFilePreviewDto> {
  requireCapability(context, "policies:write");
  const { id } = await findEnvironment(context, environmentSlug);
  const { declarations, intended } = project ?? {};
  if (declarations) {
    await authorizeProject(context, declarations.project_id);
    if (intended && typeof text === "string")
      await validateProjectBindings(
        context,
        { id, slug: environmentSlug },
        {
          yaml: text,
          declarations,
          intended,
        },
      );
  }
  const planned = await plan(context, id, text, declarations);
  const takeover = declarations
    ? await takeoverHosts(context, id, declarations.project_id)
    : null;
  return {
    issues: planned.issues,
    warnings: planned.warnings,
    policyRevision: planned.revision,
    fileDigest: fileDigest(id, text, { declarations, intended, takeover }),
    ...(declarations
      ? {
          takeover,
          ...(await projectPreviewChanges(context, id, {
            declarations,
            intended,
            text,
            policyCounts: policyCounts(planned),
            changedAgents: planned.agentsChanged,
          })),
        }
      : {}),
    ...(intended
      ? { pinsCurrent: await projectPinsCurrent(context, id, intended) }
      : {}),
    added: [...planned.agentsAdded, ...planned.added],
    changed: [...planned.agentsChanged, ...planned.changed],
    removed: planned.removed,
    ...(declarations ? { catalogRemoved: planned.catalogRemoved } : {}),
    unchanged: planned.carried.length,
  };
}

/**
 * Makes the environment match the file, as one new version: rules not in the
 * file are removed. Publishes exactly what was previewed, or refuses.
 */
export async function applyPolicyFile(
  context: PolicyWriteContext,
  environmentSlug: string,
  text: unknown,
  expected: Previewed,
): Promise<PolicyFileResultDto> {
  const environmentId = await lockEnvironment(context, environmentSlug);
  if (expected.managed) {
    await authorizeProject(context, expected.managed.project_id, {
      claim: false,
    });
    const owner = await policyOwner(context, environmentId);
    if (
      owner &&
      (owner.declarative || owner.project_id !== expected.managed.project_id)
    )
      throw new AppError(
        "RULE_CHANGED",
        "Use nodrail apply to publish a locked project policy in this environment.",
      );
  }
  await requireReviewedRepository(context, environmentId);
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

export {
  exportPolicyFile,
  namedDocument,
  readPolicyFile,
} from "./read-rule-file";
