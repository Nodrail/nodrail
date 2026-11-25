import "server-only";
import { z } from "zod";
import { InventoryReport } from "@/server/db/inventory-entities";
import { ReportedEvent } from "@/server/db/reporting-entities";
import { ContractEvent } from "@/server/db/contract-entities";
import { seesWholeWorkspace, type Role } from "@/contracts/v1/access";
import {
  changeRoleInput,
  invitableRoles,
  type AgentPeopleDto,
  type AgentPersonDto,
  type MemberChangeDto,
  type TeamDto,
} from "@/contracts/v1/team";
import {
  AppError,
  parseInput,
  parseRows,
  requireCapability,
  type WorkspaceContext,
} from "@/server/db/context";
import { AgentMember, WorkspaceMembership } from "@/server/db/entities";
import { lockAgent } from "@/server/modules/agents";
import { revokeTokensOf } from "@/server/modules/api-tokens";
import { recordAudit } from "@/server/modules/audit";
import { canGrantRole, requireRoleGrant } from "./role-grants";

type Target = { role: Role; isOwner: boolean };

/**
 * The one statement of who may change whom. Screens only reflect it. Admins
 * need ownership to touch any admin, which also stops anyone changing themself.
 */
function canManageMember(context: WorkspaceContext, target: Target) {
  if (target.isOwner) return false;
  return context.capabilities.has(
    target.role === "admin" ? "ownership:manage" : "members:manage",
  );
}

const memberRow = z.object({
  user_id: z.uuid(),
  display_name: z.string(),
  verified_email: z.string().nullable(),
  role: z.custom<Role>(),
  is_owner: z.boolean(),
  assigned_agents: z.number(),
});

const inviteRow = z.object({
  id: z.uuid(),
  normalized_email: z.string(),
  proposed_role: z.custom<Role>(),
  invited_by: z.string(),
  expires_at: z.date(),
  expired: z.boolean(),
});

function assignableRoles(context: WorkspaceContext): Role[] {
  return context.capabilities.has("ownership:manage")
    ? ["admin", ...invitableRoles]
    : [...invitableRoles];
}

export async function getTeam(context: WorkspaceContext): Promise<TeamDto> {
  const { manager, workspaceId, principal } = context;
  const managesTeam = context.capabilities.has("members:manage");
  const rows = parseRows(
    memberRow,
    await manager.query(
      `SELECT m.user_id, u.display_name, u.verified_email, m.role, m.is_owner,
              (SELECT count(*)::int FROM nodrail.agent_members am
               JOIN nodrail.agents a
                 ON a.workspace_id = am.workspace_id AND a.id = am.agent_id
               WHERE am.workspace_id = m.workspace_id AND am.user_id = m.user_id
                 AND a.archived_at IS NULL) AS assigned_agents
       FROM nodrail.workspace_memberships m
       JOIN nodrail.users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.status = 'active'
       ORDER BY m.is_owner DESC, u.display_name, m.user_id
       LIMIT 500`,
      [workspaceId],
    ),
  );
  const invites = managesTeam
    ? parseRows(
        inviteRow,
        await manager.query(
          `SELECT i.id, i.normalized_email, i.proposed_role, i.expires_at,
                  u.display_name AS invited_by,
                  i.expires_at <= clock_timestamp() AS expired
           FROM nodrail.workspace_invites i
           JOIN nodrail.users u ON u.id = i.inviter_user_id
           WHERE i.workspace_id = $1 AND i.status = 'pending'
           ORDER BY i.created_at DESC, i.id DESC
           LIMIT 200`,
          [workspaceId],
        ),
      ).map((invite) => ({
        id: invite.id,
        email: invite.normalized_email,
        role: invite.proposed_role,
        invitedBy: invite.invited_by,
        expiresAt: invite.expires_at.toISOString(),
        expired: invite.expired,
      }))
    : null;

  return {
    members: rows.map((row) => {
      const target = { role: row.role, isOwner: row.is_owner };
      return {
        userId: row.user_id,
        name: row.display_name,
        email: row.verified_email,
        role: row.role,
        isOwner: row.is_owner,
        isYou: row.user_id === principal.userId,
        assignedAgents: managesTeam ? row.assigned_agents : null,
        canManage: canManageMember(context, target),
        canMakeOwner:
          context.capabilities.has("ownership:manage") &&
          !row.is_owner &&
          row.role === "admin",
      };
    }),
    invites,
    assignableRoles: managesTeam
      ? assignableRoles(context).filter((role) => canGrantRole(context, role))
      : [],
  };
}

async function lockMember(context: WorkspaceContext, userId: string) {
  if (!z.uuid().safeParse(userId).success) throw new AppError("NOT_FOUND");
  const [row]: {
    role: Role;
    is_owner: boolean;
    display_name: string;
  }[] = await context.manager.query(
    `SELECT m.role, m.is_owner, u.display_name
     FROM nodrail.workspace_memberships m
     JOIN nodrail.users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 AND m.user_id = $2 AND m.status = 'active'
     FOR UPDATE OF m`,
    [context.workspaceId, userId],
  );
  if (!row) throw new AppError("NOT_FOUND");
  return {
    userId,
    role: row.role,
    isOwner: row.is_owner,
    name: row.display_name,
  };
}

/** Invites are the inviter's authority, so they end with it. */
function closeInvitesFrom(context: WorkspaceContext, userId: string) {
  return context.manager.query(
    `UPDATE nodrail.workspace_invites SET status = 'revoked'
     WHERE workspace_id = $1 AND inviter_user_id = $2 AND status = 'pending'`,
    [context.workspaceId, userId],
  );
}

export async function changeMemberRole(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<MemberChangeDto> {
  requireCapability(context, "members:manage");
  const { userId, role } = parseInput(changeRoleInput, rawInput);
  const target = await lockMember(context, userId);
  if (
    !canManageMember(context, target) ||
    !assignableRoles(context).includes(role)
  )
    throw new AppError("FORBIDDEN");
  if (target.role === role) return { changed: false };
  requireRoleGrant(context, role);

  await context.manager.update(
    WorkspaceMembership,
    { workspaceId: context.workspaceId, userId },
    { role },
  );
  if (target.role === "admin") await closeInvitesFrom(context, userId);
  await recordAudit(context, {
    eventType: "member.role_changed",
    decisionCode: "member_role_changed",
    payload: {
      subject: target.name,
      subjectUserId: userId,
      detail: `${target.role} → ${role}`,
    },
  });
  return { changed: true };
}

/** Ends one person's place in a workspace. Shared by removal and erasure. */
export async function detachMember(
  context: WorkspaceContext,
  userId: string,
  options: { subject: string; erasedEmail?: string | null },
): Promise<MemberChangeDto> {
  const { manager, workspaceId } = context;
  await manager.update(
    WorkspaceMembership,
    { workspaceId, userId },
    { status: "revoked", revokedAt: new Date() },
  );
  await manager.delete(AgentMember, { workspaceId, userId });
  // What their machines reported leaves with them.
  await manager.delete(InventoryReport, { workspaceId, userId });
  await manager.delete(ReportedEvent, { workspaceId, userId });
  await manager.delete(ContractEvent, { workspaceId, userId });
  await revokeTokensOf(context, userId);
  await closeInvitesFrom(context, userId);
  if (options.erasedEmail !== undefined) {
    await manager.query(
      `UPDATE nodrail.notification_outbox
       SET state = CASE WHEN state IN ('pending', 'sending') THEN 'dropped' ELSE state END,
           recipient_email = 'erased@invalid'
       WHERE workspace_id = $1 AND recipient_user_id = $2`,
      [workspaceId, userId],
    );
    await manager.query(
      `UPDATE nodrail.workspace_invites
       SET normalized_email = 'erased-' || id::text || '@invalid',
           status = CASE WHEN status = 'pending' THEN 'revoked' ELSE status END
       WHERE workspace_id = $1 AND normalized_email = lower($2)`,
      [workspaceId, options.erasedEmail ?? ""],
    );
  }
  await recordAudit(context, {
    eventType: "member.removed",
    decisionCode: "member_removed",
    payload: {
      subject: options.subject,
      subjectUserId: userId,
    },
  });
  return { changed: true };
}

export async function removeMember(
  context: WorkspaceContext,
  userId: string,
): Promise<MemberChangeDto> {
  requireCapability(context, "members:manage");
  const target = await lockMember(context, userId);
  if (!canManageMember(context, target)) throw new AppError("FORBIDDEN");
  return detachMember(context, userId, { subject: target.name });
}

/** The old owner stays an admin. The unique index allows one owner at a time. */
export async function transferOwnership(
  context: WorkspaceContext,
  userId: string,
): Promise<void> {
  requireCapability(context, "ownership:manage");
  const target = await lockMember(context, userId);
  if (target.isOwner || target.role !== "admin")
    throw new AppError("INVALID_INPUT");
  const { manager, workspaceId, principal } = context;
  await manager.update(
    WorkspaceMembership,
    { workspaceId, userId: principal.userId },
    { isOwner: false },
  );
  await manager.update(
    WorkspaceMembership,
    { workspaceId, userId },
    { isOwner: true },
  );
  await recordAudit(context, {
    eventType: "ownership.transferred",
    decisionCode: "ownership_transferred",
    payload: { subject: target.name, subjectUserId: target.userId },
  });
}

const personRow = z.object({
  user_id: z.uuid(),
  display_name: z.string(),
  role: z.custom<Role>(),
  assigned: z.boolean(),
});

const toPerson = (row: z.infer<typeof personRow>): AgentPersonDto => ({
  userId: row.user_id,
  name: row.display_name,
  role: row.role,
});

/** Only people limited to assigned agents: everyone else already sees it. */
export async function getAgentPeople(
  context: WorkspaceContext,
  agentKey: string,
): Promise<AgentPeopleDto> {
  requireCapability(context, "members:manage");
  const rows = parseRows(
    personRow,
    await context.manager.query(
      `SELECT m.user_id, u.display_name, m.role,
              EXISTS (SELECT 1 FROM nodrail.agent_members am
                      JOIN nodrail.agents a
                        ON a.workspace_id = am.workspace_id AND a.id = am.agent_id
                      WHERE am.workspace_id = m.workspace_id
                        AND am.user_id = m.user_id
                        AND a.external_key = $2) AS assigned
       FROM nodrail.workspace_memberships m
       JOIN nodrail.users u ON u.id = m.user_id
       WHERE m.workspace_id = $1 AND m.status = 'active'
         AND m.role = 'viewer'
       ORDER BY u.display_name, m.user_id
       LIMIT 500`,
      [context.workspaceId, agentKey],
    ),
  );
  return {
    assigned: rows.filter((row) => row.assigned).map(toPerson),
    available: rows.filter((row) => !row.assigned).map(toPerson),
  };
}

export async function assignAgent(
  context: WorkspaceContext,
  agentKey: string,
  userId: string,
): Promise<void> {
  requireCapability(context, "members:manage");
  const target = await lockMember(context, userId);
  if (seesWholeWorkspace(target.role)) throw new AppError("INVALID_INPUT");
  const agent = await lockAgent(context, agentKey);
  const { workspaceId } = context;
  await context.manager
    .createQueryBuilder()
    .insert()
    .into(AgentMember)
    .values({ workspaceId, agentId: agent.id, userId })
    .orIgnore()
    .execute();
  await recordAudit(context, {
    eventType: "agent.assigned",
    decisionCode: "agent_assigned",
    agentId: agent.id,
    payload: { subject: target.name, subjectUserId: target.userId },
  });
}

/** Takes the agent lock first, so a decision in flight sees the outcome. */
export async function unassignAgent(
  context: WorkspaceContext,
  agentKey: string,
  userId: string,
): Promise<MemberChangeDto> {
  requireCapability(context, "members:manage");
  const target = await lockMember(context, userId);
  const agent = await lockAgent(context, agentKey);
  const { workspaceId } = context;
  await context.manager.delete(AgentMember, {
    workspaceId,
    agentId: agent.id,
    userId,
  });
  await recordAudit(context, {
    eventType: "agent.unassigned",
    decisionCode: "agent_unassigned",
    agentId: agent.id,
    payload: { subject: target.name, subjectUserId: userId },
  });
  return { changed: true };
}
