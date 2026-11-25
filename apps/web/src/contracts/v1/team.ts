import { z } from "zod";
import { roles, type Role } from "./access";
import { createWorkspaceInput } from "./workspaces";

export const INVITE_TTL_DAYS = 7;

/** Admin is never offered in an invite: only the owner can grant it. */
export const invitableRoles = ["policy_manager", "viewer"] as const;

export const inviteInput = z
  .object({
    email: z.preprocess(
      (value) =>
        typeof value === "string" ? value.trim().toLowerCase() : value,
      z.email().max(254),
    ),
    role: z.enum(invitableRoles),
  })
  .strict();

export const changeRoleInput = z
  .object({ userId: z.uuid(), role: z.enum(roles) })
  .strict();

export const workspaceSettingsInput = z
  .object({
    name: createWorkspaceInput.shape.name,
    defaultEnvironment: z.string().min(1).max(63),
  })
  .strict();

export const notificationPreferencesInput = z
  .object({
    integrationStale: z.boolean(),
    usageAlerts: z.boolean(),
  })
  .strict();

export type NotificationPreferencesDto = z.infer<
  typeof notificationPreferencesInput
>;

export type TeamMemberDto = {
  userId: string;
  name: string;
  email: string | null;
  role: Role;
  isOwner: boolean;
  isYou: boolean;
  /** Only for people who manage the team. */
  assignedAgents: number | null;
  canManage: boolean;
  canMakeOwner: boolean;
};

export type InviteDto = {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  expiresAt: string;
  expired: boolean;
};

export type TeamDto = {
  members: TeamMemberDto[];
  /** Null for people who cannot manage the team. */
  invites: InviteDto[] | null;
  assignableRoles: Role[];
};

export type InviteViewDto =
  | { status: "unavailable" }
  | { status: "wrong_email"; workspace: string }
  | { status: "already_member"; workspace: string; slug: string }
  | {
      status: "open";
      workspace: string;
      role: Role;
      invitedBy: string;
    };

export type AgentPersonDto = { userId: string; name: string; role: Role };

export type AgentPeopleDto = {
  assigned: AgentPersonDto[];
  available: AgentPersonDto[];
};

/** Whether anything changed: a role set to the one it had changes nothing. */
export type MemberChangeDto = { changed: boolean };
