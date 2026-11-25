"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { type ActionResult } from "@/components/app/action-result";
import type { Role } from "@/contracts/v1/access";
import type { MemberChangeDto } from "@/contracts/v1/team";
import {
  loadWorkspaceView,
  runWorkspaceAction,
} from "@/features/shell/load-view";
import { roleLabels } from "@/features/shell/navigation";
import { requirePrincipal } from "@/server/auth/current";
import { appOrigin } from "@/server/app-origin";
import { AppError } from "@/server/db/context";
import { describeError } from "@/server/log";
import { emailConfigured, sendEmail } from "@/server/notifications/mailer";
import { renderInvite } from "@/server/notifications/render";
import {
  acceptInvite,
  createInvite,
  revokeInvite,
} from "@/server/modules/team/invites";
import {
  assignAgent,
  changeMemberRole,
  removeMember,
  transferOwnership,
  unassignAgent,
} from "@/server/modules/team/members";
import { appPath } from "@/lib/product-path";

export type IssuedInvite = { url: string; emailed: boolean };

type RunResult<T> = Awaited<ReturnType<typeof runWorkspaceAction<T>>>;

function afterMemberChange(
  prefix: string,
  result: RunResult<MemberChangeDto>,
): ActionResult {
  return result.status === "ok"
    ? { status: "ok", message: `${prefix}.` }
    : result;
}

function done(message: string, result: RunResult<unknown>): ActionResult {
  return result.status === "ok" ? { status: "ok", message } : result;
}

export async function inviteAction(
  workspace: string,
  _previous: ActionResult<IssuedInvite>,
  data: FormData,
): Promise<ActionResult<IssuedInvite>> {
  const email = data.get("email");
  const role = data.get("role");
  const result = await runWorkspaceAction(
    workspace,
    (context) => createInvite(context, { email, role }),
    {
      ALREADY_EXISTS:
        "That person is already on the team or has an open invite.",
      INVALID_INPUT: "Enter a valid email address.",
    },
  );
  if (result.status !== "ok") return result;
  const url = `${appOrigin()}/invite/${result.value.token}`;
  const emailed = await emailInvite(
    workspace,
    typeof email === "string" ? email : "",
    role,
    url,
  );
  return {
    status: "ok",
    message: emailed ? "Invite sent." : "Invite link created.",
    data: { url, emailed },
  };
}

/** The token is never stored, so this is sent now or not at all. */
async function emailInvite(
  slug: string,
  to: string,
  role: FormDataEntryValue | null,
  url: string,
) {
  if (!emailConfigured()) return false;
  try {
    const view = await loadWorkspaceView(slug);
    await sendEmail({
      ...renderInvite(
        {
          workspace: view.name,
          invitedBy: view.person.name,
          role: roleLabels[role as Role] ?? "a member",
        },
        url,
      ),
      to,
      messageId: randomUUID(),
    });
    return true;
  } catch (error) {
    console.error("Invite email failed", describeError(error));
    return false;
  }
}

export async function revokeInviteAction(
  workspace: string,
  inviteId: string,
): Promise<ActionResult> {
  return done(
    "Invite revoked.",
    await runWorkspaceAction(workspace, (context) =>
      revokeInvite(context, inviteId),
    ),
  );
}

export async function changeRoleAction(
  workspace: string,
  userId: string,
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  return afterMemberChange(
    "Role updated",
    await runWorkspaceAction(workspace, (context) =>
      changeMemberRole(context, { userId, role: data.get("role") }),
    ),
  );
}

export async function removeMemberAction(
  workspace: string,
  userId: string,
): Promise<ActionResult> {
  return afterMemberChange(
    "Teammate removed",
    await runWorkspaceAction(workspace, (context) =>
      removeMember(context, userId),
    ),
  );
}

export async function transferOwnershipAction(
  workspace: string,
  userId: string,
): Promise<ActionResult> {
  return done(
    "Ownership transferred.",
    await runWorkspaceAction(workspace, (context) =>
      transferOwnership(context, userId),
    ),
  );
}

export async function assignAgentAction(
  workspace: string,
  agentKey: string,
  _previous: ActionResult,
  data: FormData,
): Promise<ActionResult> {
  const userId = data.get("userId");
  return done(
    "Agent assigned.",
    await runWorkspaceAction(workspace, (context) =>
      assignAgent(context, agentKey, typeof userId === "string" ? userId : ""),
    ),
  );
}

export async function unassignAgentAction(
  workspace: string,
  agentKey: string,
  userId: string,
): Promise<ActionResult> {
  return afterMemberChange(
    "Agent unassigned",
    await runWorkspaceAction(workspace, (context) =>
      unassignAgent(context, agentKey, userId),
    ),
  );
}

export async function acceptInviteAction(
  token: string,
): Promise<{ error: string }> {
  const principal = await requirePrincipal();
  let slug: string;
  try {
    ({ slug } = await acceptInvite(principal, token));
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { error: "This invite is no longer available." };
  }
  redirect(appPath(slug));
}
