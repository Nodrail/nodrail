import "server-only";
import { randomUUID } from "node:crypto";
import type { Machine, ProjectApply } from "@/contracts/v1/project-apply";
import {
  AppError,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { Agent, AgentMember, Installation } from "@/server/db/entities";
import { recordAudit } from "@/server/modules/audit";
import { matchesDigest } from "@/server/security/secrets";
import {
  closeCredential,
  issueCredential,
  storeCredential,
  supportedHostScopes,
} from "./credentials";

type Binding = { environmentId: string; projectId: string };

type EnrollmentRow = {
  id: string;
  agent_id: string;
  archived: boolean;
  disabled: boolean;
  enrollment_agent_keys: string[];
  scopes: string[] | null;
  owned: boolean;
  public_prefix: string | null;
  secret_digest: string | null;
};

async function enrollment(
  context: WorkspaceContext,
  binding: Binding,
  machine: Machine,
) {
  const [row]: EnrollmentRow[] = await context.manager.query(
    `SELECT i.id, i.agent_id, (i.archived_at IS NOT NULL OR a.archived_at IS NOT NULL) AS archived,
            i.enrollment_owner_id = $5 AS owned,
            i.enrollment_disabled_at IS NOT NULL AS disabled,
            i.enrollment_agent_keys, c.scopes, c.public_prefix, c.secret_digest
     FROM nodrail.installations i
     JOIN nodrail.agents a ON a.workspace_id = i.workspace_id AND a.id = i.agent_id
     LEFT JOIN nodrail.installation_credentials c
       ON c.workspace_id = i.workspace_id AND c.installation_id = i.id
       AND c.revoked_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > clock_timestamp())
     WHERE i.workspace_id = $1 AND i.environment_id = $2
       AND i.enrollment_project_id = $3 AND i.enrollment_machine_id = $4`,
    [
      context.workspaceId,
      binding.environmentId,
      binding.projectId,
      machine.id,
      context.principal.userId,
    ],
  );
  const [, prefix, secret] =
    /^ndr_([a-f0-9]{12})_(.+)$/.exec(machine.credential ?? "") ?? [];
  const valid = !!(
    row &&
    !row.archived &&
    !row.disabled &&
    prefix === row.public_prefix &&
    secret &&
    row.secret_digest &&
    matchesDigest(secret, row.secret_digest)
  );
  return { row, valid };
}

export async function enrollmentStatus(
  context: WorkspaceContext,
  binding: Binding,
  machine: Machine,
  desiredKeys?: string[],
) {
  const { row, valid } = await enrollment(context, binding, machine);
  if (row) assertRecoverable(row, valid);
  const fresh =
    valid &&
    desiredKeys !== undefined &&
    sameSet(row?.enrollment_agent_keys, desiredKeys) &&
    sameSet(row?.scopes, await supportedHostScopes(context, binding));
  return {
    valid,
    fresh,
    installationId: valid ? row!.id : null,
    currentCredential: row?.public_prefix ?? null,
  };
}

function assertRecoverable(row: EnrollmentRow, valid: boolean) {
  if (row.archived)
    throw new AppError(
      "FORBIDDEN",
      "This enrollment was archived. Ask a workspace admin to restore machine access.",
    );
  if (row.disabled)
    throw new AppError(
      "FORBIDDEN",
      "This machine's enrollment was revoked. Ask a workspace admin to reactivate it by rotating the credential in Agents.",
    );
  if (!valid && !row.owned)
    throw new AppError(
      "FORBIDDEN",
      "Sign in as the user who enrolled this machine to recover its credential.",
    );
}

async function createMachine(
  context: WorkspaceContext,
  binding: Binding,
  machine: Machine,
  keys: string[],
) {
  const { manager, workspaceId, principal } = context;
  const key = `host-${randomUUID()}`;
  const agent = await manager.save(Agent, {
    workspaceId,
    externalKey: key,
    description: "Enrolled machine",
  });
  await manager.insert(AgentMember, {
    workspaceId,
    agentId: agent.id,
    userId: principal.userId,
  });
  return manager.save(Installation, {
    workspaceId,
    agentId: agent.id,
    environmentId: binding.environmentId,
    name: key,
    adapterKey: `${machine.runtime}-hook`,
    enrollmentProjectId: binding.projectId,
    enrollmentMachineId: machine.id,
    enrollmentOwnerId: principal.userId,
    enrollmentAgentKeys: keys,
  });
}

function sameSet(actual: string[] | null | undefined, expected: string[]) {
  return (
    actual?.length === expected.length &&
    expected.every((entry) => actual.includes(entry))
  );
}

async function requireUncancelled(
  context: WorkspaceContext,
  binding: Binding,
  machine: NonNullable<ProjectApply["machine"]>,
) {
  const proposed = machine.proposed_credential;
  if (!proposed) return;
  const [cancelled]: unknown[] = await context.manager.query(
    `SELECT 1 FROM nodrail.cancelled_enrollment_generations
     WHERE workspace_id = $1 AND environment_id = $2 AND project_id = $3
       AND machine_id = $4 AND generation = $5`,
    [
      context.workspaceId,
      binding.environmentId,
      binding.projectId,
      machine.id,
      proposed.prefix,
    ],
  );
  if (cancelled)
    throw new AppError(
      "RULE_CHANGED",
      "This enrollment was cancelled. Run nodrail destroy, then apply again.",
    );
}

/** The caller holds this environment's publication lock throughout apply. */
export async function enrollMachine(
  context: WorkspaceContext,
  binding: Binding,
  machine: NonNullable<ProjectApply["machine"]>,
  keys: string[],
) {
  requireCapability(context, "projects:apply");
  const { manager, workspaceId } = context;
  const previous = await enrollment(context, binding, machine);
  if (previous.row)
    await manager.query(
      "SELECT id FROM nodrail.agents WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
      [workspaceId, previous.row.agent_id],
    );
  // Console revocation and rotation take the same agent lock.
  const status = await enrollmentStatus(context, binding, machine);
  if (!status.valid && status.currentCredential !== machine.expected_credential)
    throw new AppError(
      "RULE_CHANGED",
      "The machine credential changed. Run nodrail apply again.",
    );
  const installationId =
    previous.row?.id ??
    (await createMachine(context, binding, machine, keys)).id;
  const scopes = await supportedHostScopes(context, binding);
  if (previous.row)
    await manager.update(
      Installation,
      { workspaceId, id: installationId },
      { enrollmentAgentKeys: keys },
    );
  const proposed = machine.proposed_credential;
  if (status.valid) {
    await manager.query(
      `UPDATE nodrail.installation_credentials SET scopes = $3
       WHERE workspace_id = $1 AND installation_id = $2 AND revoked_at IS NULL AND scopes IS DISTINCT FROM $3::text[]`,
      [workspaceId, installationId, scopes],
    );
    return {
      installationId,
      credential: null,
      ...(proposed ? { credentialGeneration: status.currentCredential } : {}),
    };
  }

  await requireUncancelled(context, binding, machine);
  await closeCredential(context, installationId);
  const credential = proposed
    ? { prefix: proposed.prefix, secret: null }
    : await issueCredential(context, installationId, scopes);
  if (proposed)
    await storeCredential(context, installationId, scopes, proposed);
  await recordAudit(context, {
    eventType: previous.row ? "credential.rotated" : "agent.connected",
    decisionCode: previous.row ? "credential_rotated" : "agent_connected",
    environmentId: binding.environmentId,
    payload: {
      subject: binding.projectId,
      detail: "Machine enrollment",
      prefix: credential.prefix,
    },
  });
  return {
    installationId,
    credential: credential.secret,
    ...(proposed ? { credentialGeneration: credential.prefix } : {}),
  };
}
