"use client";

import {
  ConfirmDialog,
  type ConfirmProps,
} from "@/components/app/confirm-dialog";
import { SelectField } from "@/components/app/form-field";
import { RowActions } from "@/components/app/row-actions";
import type { Role } from "@/contracts/v1/access";
import type { TeamMemberDto } from "@/contracts/v1/team";
import {
  changeRoleAction,
  removeMemberAction,
  revokeInviteAction,
  transferOwnershipAction,
} from "../actions";
import { RoleOptions } from "./role-options";

/** The new role, from the roles this person may grant. */
function changeRole(
  workspace: string,
  member: TeamMemberDto,
  assignableRoles: Role[],
): ConfirmProps<unknown> {
  const { userId, name } = member;
  return {
    title: `Change ${name}'s role`,
    confirmLabel: "Save role",
    confirmVariant: "default",
    action: changeRoleAction.bind(null, workspace, userId),
    children: (
      <>
        <SelectField
          id={`role-${userId}`}
          name="role"
          label="Role"
          defaultValue={member.role}
        >
          <RoleOptions roles={assignableRoles} />
        </SelectField>
      </>
    ),
  };
}

function makeOwner(
  workspace: string,
  { userId, name }: TeamMemberDto,
): ConfirmProps<unknown> {
  return {
    kicker: "Transfer ownership",
    title: `Make ${name} the owner?`,
    confirmLabel: "Transfer ownership",
    action: transferOwnershipAction.bind(null, workspace, userId),
    children: (
      <p>
        {name} becomes the only person who can manage admins and ownership. You
        stay an admin and cannot undo this yourself.
      </p>
    ),
  };
}

function removeMember(
  workspace: string,
  { userId, name }: TeamMemberDto,
): ConfirmProps<unknown> {
  return {
    title: `Remove ${name} from this workspace?`,
    confirmLabel: "Remove teammate",
    action: removeMemberAction.bind(null, workspace, userId),
    children: (
      <p>
        They lose access immediately, and their agent assignments end. Anything
        they allowed that the agent has not collected yet is closed. Their past
        decisions stay in Activity.
      </p>
    ),
  };
}

/**
 * A member's "⋯" menu: Change role, Make owner and Remove, each after a
 * confirmation and only when the server would allow it, and Copy email.
 */
export function MemberActions({
  workspace,
  member,
  assignableRoles,
}: {
  workspace: string;
  member: TeamMemberDto;
  assignableRoles: Role[];
}) {
  return (
    <RowActions
      name={member.name}
      items={[
        member.canManage
          ? {
              label: "Change role…",
              confirm: changeRole(workspace, member, assignableRoles),
            }
          : null,
        member.canMakeOwner
          ? { label: "Make owner…", confirm: makeOwner(workspace, member) }
          : null,
        member.email
          ? { label: "Copy email", copy: member.email, copied: "Email copied." }
          : null,
        "separator",
        member.canManage
          ? {
              label: "Remove…",
              destructive: true,
              confirm: removeMember(workspace, member),
            }
          : null,
      ]}
    />
  );
}

export function RevokeInviteButton({
  workspace,
  invite,
}: {
  workspace: string;
  invite: { id: string; email: string };
}) {
  return (
    <ConfirmDialog
      title={`Revoke the invite for ${invite.email}?`}
      triggerLabel="Revoke"
      confirmLabel="Revoke invite"
      action={revokeInviteAction.bind(null, workspace, invite.id)}
    >
      <p>The link stops working. You can invite them again later.</p>
    </ConfirmDialog>
  );
}
