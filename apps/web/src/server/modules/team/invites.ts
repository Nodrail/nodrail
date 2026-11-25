import "server-only";
import { z } from "zod";
import {
  INVITE_TTL_DAYS,
  inviteInput,
  type InviteViewDto,
} from "@/contracts/v1/team";
import type { Role } from "@/contracts/v1/access";
import {
  AppError,
  inNewWorkspace,
  parseInput,
  parseRows,
  requireCapability,
  withUser,
  type HumanPrincipal,
  type WorkspaceContext,
  type UserContext,
} from "@/server/db/context";
import { WorkspaceInvite, WorkspaceMembership } from "@/server/db/entities";
import { recordAudit } from "@/server/modules/audit";
import { digestSecret, newSecret } from "@/server/security/secrets";
import { requireRoleGrant } from "./role-grants";

/** Issues a single-use link. The token exists only in this response. */
export async function createInvite(
  context: WorkspaceContext,
  rawInput: unknown,
): Promise<{ token: string }> {
  requireCapability(context, "members:manage");
  const { email, role } = parseInput(inviteInput, rawInput);
  requireRoleGrant(context, role);
  const { manager, workspaceId, principal } = context;

  const [member]: unknown[] = await manager.query(
    `SELECT 1 FROM nodrail.workspace_memberships m
     JOIN nodrail.users u ON u.id = m.user_id
     WHERE m.workspace_id = $1 AND m.status = 'active'
       AND lower(u.verified_email) = $2`,
    [workspaceId, email],
  );
  if (member) throw new AppError("ALREADY_EXISTS");

  // An expired invite must not block a new one for the same address.
  await manager.query(
    `UPDATE nodrail.workspace_invites SET status = 'revoked'
     WHERE workspace_id = $1 AND normalized_email = $2
       AND status = 'pending' AND expires_at <= clock_timestamp()`,
    [workspaceId, email],
  );

  const token = `ndi_${newSecret()}`;
  await manager.insert(WorkspaceInvite, {
    workspaceId,
    normalizedEmail: email,
    proposedRole: role,
    tokenDigest: digestSecret(token),
    inviterUserId: principal.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
  });
  await recordAudit(context, {
    eventType: "member.invited",
    decisionCode: "member_invited",
    payload: { subject: email, detail: role },
  });
  return { token };
}

export async function revokeInvite(
  context: WorkspaceContext,
  inviteId: string,
): Promise<void> {
  requireCapability(context, "members:manage");
  if (!z.uuid().safeParse(inviteId).success) throw new AppError("NOT_FOUND");
  const [closed]: [{ normalized_email: string }[], number] =
    await context.manager.query(
      `UPDATE nodrail.workspace_invites SET status = 'revoked'
       WHERE workspace_id = $1 AND id = $2 AND status = 'pending'
       RETURNING normalized_email`,
      [context.workspaceId, inviteId],
    );
  const [invite] = closed;
  if (!invite) throw new AppError("NOT_FOUND");
  await recordAudit(context, {
    eventType: "member.invite_revoked",
    decisionCode: "invite_revoked",
    payload: { subject: invite.normalized_email },
  });
}

const inviteRow = z.object({
  id: z.uuid(),
  normalized_email: z.string(),
  proposed_role: z.custom<Exclude<Role, "admin">>(),
  status: z.enum(["pending", "accepted", "revoked"]),
  expired: z.boolean(),
  accepted_by: z.uuid().nullable(),
  inviter_user_id: z.uuid(),
  workspace_name: z.string(),
  slug: z.string(),
  invited_by: z.string(),
});

/** Which workspace a token belongs to: the only lookup outside any tenant. */
async function workspaceForToken(principal: HumanPrincipal, digest: string) {
  return withUser(principal, async ({ manager }) => {
    const [row]: { id: string | null }[] = await manager.query(
      `SELECT nodrail.workspace_for_invite($1) AS id`,
      [digest],
    );
    return row?.id ?? null;
  });
}

async function readInvite({ manager }: UserContext, digest: string) {
  const [row] = parseRows(
    inviteRow,
    await manager.query(
      `SELECT i.id, i.normalized_email, i.proposed_role, i.status, i.accepted_by,
              i.inviter_user_id, i.expires_at <= clock_timestamp() AS expired,
              w.name AS workspace_name, w.slug, u.display_name AS invited_by
       FROM nodrail.workspace_invites i
       JOIN nodrail.workspaces w ON w.id = i.workspace_id
       JOIN nodrail.users u ON u.id = i.inviter_user_id
       WHERE i.token_digest = $1 AND w.archived_at IS NULL`,
      [digest],
    ),
  );
  return row;
}

async function verifiedEmail({ manager, principal }: UserContext) {
  const [person]: { verified_email: string | null }[] = await manager.query(
    `SELECT verified_email FROM nodrail.users WHERE id = $1`,
    [principal.userId],
  );
  return person?.verified_email?.toLowerCase() ?? null;
}

async function isActiveMember(
  { manager, principal }: UserContext,
  workspaceId: string,
) {
  const [member]: unknown[] = await manager.query(
    `SELECT 1 FROM nodrail.workspace_memberships
     WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
    [workspaceId, principal.userId],
  );
  return Boolean(member);
}

/** Every dead token reads the same, so a guess learns nothing. */
export async function viewInvite(
  principal: HumanPrincipal,
  token: string,
): Promise<InviteViewDto> {
  const digest = digestSecret(token);
  const workspaceId = await workspaceForToken(principal, digest);
  if (!workspaceId) return { status: "unavailable" };
  return inNewWorkspace(principal, workspaceId, async (context) => {
    const invite = await readInvite(context, digest);
    if (!invite || invite.status !== "pending" || invite.expired)
      return { status: "unavailable" };
    if ((await verifiedEmail(context)) !== invite.normalized_email)
      return { status: "wrong_email", workspace: invite.workspace_name };
    if (await isActiveMember(context, workspaceId))
      return {
        status: "already_member",
        workspace: invite.workspace_name,
        slug: invite.slug,
      };
    return {
      status: "open",
      workspace: invite.workspace_name,
      role: invite.proposed_role,
      invitedBy: invite.invited_by,
    };
  });
}

/**
 * Lock order: the inviter's membership, then the invite. Removing an inviter
 * takes the same order and closes their invites, so one of the two wins whole.
 */
export async function acceptInvite(
  principal: HumanPrincipal,
  token: string,
): Promise<{ slug: string }> {
  const digest = digestSecret(token);
  const workspaceId = await workspaceForToken(principal, digest);
  if (!workspaceId) throw new AppError("NOT_FOUND");

  return inNewWorkspace(principal, workspaceId, async (context) => {
    const { manager } = context;
    const preview = await readInvite(context, digest);
    if (!preview) throw new AppError("NOT_FOUND");
    await manager.query(
      `SELECT 1 FROM nodrail.workspace_memberships
       WHERE workspace_id = $1 AND user_id = $2 FOR SHARE`,
      [workspaceId, preview.inviter_user_id],
    );
    await manager.query(
      `SELECT 1 FROM nodrail.workspace_invites
       WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
      [workspaceId, preview.id],
    );
    const invite = await readInvite(context, digest);
    if (!invite) throw new AppError("NOT_FOUND");
    // A double click finds its own acceptance.
    if (invite.status === "accepted" && invite.accepted_by === principal.userId)
      return { slug: invite.slug };
    if (invite.status !== "pending" || invite.expired)
      throw new AppError("NOT_FOUND");
    if ((await verifiedEmail(context)) !== invite.normalized_email)
      throw new AppError("FORBIDDEN");

    if (!(await isActiveMember(context, workspaceId)))
      await manager
        .createQueryBuilder()
        .insert()
        .into(WorkspaceMembership)
        .values({
          workspaceId,
          userId: principal.userId,
          role: invite.proposed_role,
        })
        .orUpdate(["role", "status", "revoked_at"], ["workspace_id", "user_id"])
        .execute();

    await manager.update(
      WorkspaceInvite,
      { workspaceId, id: invite.id },
      {
        status: "accepted",
        acceptedBy: principal.userId,
        acceptedAt: new Date(),
      },
    );
    await recordAudit(
      { ...context, workspaceId },
      {
        eventType: "member.joined",
        decisionCode: "invite_accepted",
        payload: {
          subject: invite.normalized_email,
          detail: invite.proposed_role,
        },
      },
    );
    return { slug: invite.slug };
  });
}
