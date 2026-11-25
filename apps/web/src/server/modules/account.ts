import "server-only";
import {
  asMaintenance,
  AppError,
  readWorkspace,
  withUser,
  withWorkspace,
  type HumanPrincipal,
} from "@/server/db/context";
import { detachMember } from "@/server/modules/team/members";
import { listMyWorkspaces } from "@/server/modules/workspaces";

async function personOf(principal: HumanPrincipal) {
  return withUser(principal, async ({ manager }) => {
    const [row]: { display_name: string; verified_email: string | null }[] =
      await manager.query(
        `SELECT display_name, verified_email FROM nodrail.users WHERE id = $1`,
        [principal.userId],
      );
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  });
}

export async function accountEmail(principal: HumanPrincipal) {
  return (await personOf(principal)).verified_email ?? "";
}

/**
 * Removes a person. Each step can safely run again, so an interrupted erasure is
 * finished by retrying. What they decided stays, attributed to no one.
 */
export async function eraseAccount(
  principal: HumanPrincipal,
  confirmation: unknown,
) {
  const person = await personOf(principal);
  if (
    typeof confirmation !== "string" ||
    confirmation.trim().toLowerCase() !== person.verified_email?.toLowerCase()
  )
    throw new AppError("INVALID_INPUT");

  const workspaces = await listMyWorkspaces(principal);
  for (const { id } of workspaces)
    if (await readWorkspace(principal, id, async (context) => context.isOwner))
      throw new AppError("OWNS_WORKSPACE");

  for (const { id } of workspaces)
    await withWorkspace(principal, id, (context) =>
      detachMember(context, principal.userId, {
        subject: "A former member",
        erasedEmail: person.verified_email,
      }),
    );

  // Only this person's workspaces, and only rows that are about this person.
  const memberOf = await withUser(
    principal,
    ({ manager }): Promise<{ workspace_id: string }[]> =>
      manager.query(
        `SELECT workspace_id FROM nodrail.workspace_memberships
         WHERE user_id = $1`,
        [principal.userId],
      ),
  );
  await asMaintenance((manager) =>
    manager.query(
      `UPDATE nodrail.audit_events
       SET payload_safe = payload_safe - 'subject' - 'subjectUserId'
       WHERE workspace_id = ANY($1::uuid[])
         AND (payload_safe->>'subjectUserId' = $2
              OR payload_safe->>'subject' = $3)`,
      [
        memberOf.map((row) => row.workspace_id),
        principal.userId,
        person.verified_email?.toLowerCase() ?? "",
      ],
    ),
  );
  await withUser(principal, ({ manager }) =>
    manager.query("SELECT nodrail.erase_current_user()"),
  );
}
