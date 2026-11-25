"use client";

import { useCallback, useState } from "react";
import { track } from "@/components/analytics/posthog";
import type { ActionResult } from "@/components/app/action-result";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField, SelectField } from "@/components/app/form-field";
import { SecretDialog } from "@/components/app/secret-dialog";
import { INVITE_TTL_DAYS, invitableRoles } from "@/contracts/v1/team";
import { inviteAction, type IssuedInvite } from "../actions";
import { FormHint } from "@/components/app/note";
import { RoleOptions } from "./role-options";

/** The link is shown once, so it must not be something a click can dismiss. */
function InviteReady({
  invite,
  onDone,
}: {
  invite: IssuedInvite;
  onDone: () => void;
}) {
  return (
    <SecretDialog
      dialogLabel="Invite ready"
      title={invite.emailed ? "Invite sent" : "Invite link ready"}
      secretLabel="Invite link"
      secret={invite.url}
      onDone={onDone}
    >
      <FormHint>
        {invite.emailed
          ? "We emailed this link to your teammate. You can also send it yourself."
          : "We couldn't email it, so send this to your teammate yourself."}{" "}
        It works once and expires in {INVITE_TTL_DAYS} days.
      </FormHint>
    </SecretDialog>
  );
}

type Issued = Extract<ActionResult<IssuedInvite>, { status: "ok" }>;

/** Sending the link is up to the person inviting until email delivery exists. */
export function InvitePanel({ workspace }: { workspace: string }) {
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const show = useCallback((result: Issued) => {
    track("teammate_invited");
    if (result.data) setIssued(result.data);
  }, []);
  return (
    <>
      <ConfirmDialog
        title="Invite a teammate"
        triggerLabel="Invite teammate"
        triggerVariant="default"
        confirmLabel="Create invite link"
        confirmVariant="default"
        action={inviteAction.bind(null, workspace)}
        onSuccess={show}
      >
        <FormField
          id="invite-email"
          name="email"
          label="Email"
          type="email"
          autoComplete="off"
          autoFocus
          required
          hint="The link only works for someone signed in with this address."
        />
        <SelectField id="invite-role" name="role" label="Role">
          <RoleOptions roles={invitableRoles} />
        </SelectField>
      </ConfirmDialog>
      {issued ? (
        <InviteReady invite={issued} onDone={() => setIssued(null)} />
      ) : null}
    </>
  );
}
