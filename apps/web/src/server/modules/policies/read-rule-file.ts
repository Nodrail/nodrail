import "server-only";
import type { PolicyDocument, PolicyGate } from "@nodrail/sdk";
import { requireCapability, type WorkspaceContext } from "@/server/db/context";
import { ActivePolicy } from "@/server/db/entities";
import { findEnvironment } from "@/server/modules/workspaces";
import { toPolicyRule, versionDocument } from "@/server/modules/runs/history";
import { fileOf } from "./contract-file";

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
