import "server-only";
import type { DecisionCode } from "@/contracts/v1/activity";
import type { EntityManager } from "typeorm";
import type { RuntimeContext, WorkspaceContext } from "@/server/db/context";
import { AuditEvent } from "@/server/db/entities";

export type AuditEntry = {
  eventType: string;
  occurredAt?: Date;
  decisionCode: DecisionCode;
  actionRequestId?: string;
  agentId?: string;
  environmentId?: string;
  policyVersionId?: string;
  matchedLogicalRuleId?: string;
  payload?: Record<string, unknown>;
};

function insertAudit(
  manager: EntityManager,
  workspaceId: string,
  actor: Pick<AuditEvent, "actorKind"> &
    Partial<
      Pick<AuditEvent, "actorUserId" | "actorCredentialId" | "actorTokenId">
    >,
  { payload, ...entry }: AuditEntry,
) {
  return manager.insert(AuditEvent, {
    ...entry,
    ...actor,
    workspaceId,
    payloadSafe: payload ?? {},
  });
}

/**
 * Written in the same transaction as the change it records. A change made
 * with an API token names the token, so Activity says how it was made.
 */
export async function recordAudit(
  context: Pick<WorkspaceContext, "manager" | "principal" | "workspaceId">,
  entry: AuditEntry,
) {
  const { principal } = context;
  await insertAudit(
    context.manager,
    context.workspaceId,
    {
      actorKind: "human",
      actorUserId: principal.userId,
      actorTokenId: "tokenId" in principal ? principal.tokenId : null,
    },
    entry,
  );
}

/** Nodrail's own verdict on a runtime call, tied to the credential that asked. */
export async function recordRuntimeDecision(
  context: RuntimeContext,
  entry: AuditEntry,
) {
  await insertAudit(
    context.manager,
    context.workspaceId,
    { actorKind: "system", actorCredentialId: context.credentialId },
    entry,
  );
}

/** Something that happened with no person or credential behind it. */
export async function recordSystemEvent(
  scope: { manager: EntityManager; workspaceId: string },
  entry: AuditEntry,
) {
  await insertAudit(
    scope.manager,
    scope.workspaceId,
    { actorKind: "system" },
    entry,
  );
}
