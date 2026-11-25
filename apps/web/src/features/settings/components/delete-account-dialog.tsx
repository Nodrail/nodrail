"use client";

import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { FormField } from "@/components/app/form-field";
import { deleteAccountAction } from "../actions";

export function DeleteAccountDialog({ email }: { email: string }) {
  return (
    <ConfirmDialog
      kicker="Delete account"
      title="Delete your account?"
      triggerLabel="Delete my account"
      confirmLabel="Delete my account"
      action={deleteAccountAction.bind(null)}
    >
      <p>
        You leave every workspace and your name and email are removed. Past
        decisions stay in each team&apos;s history, without your name. This
        can&apos;t be undone.
      </p>
      <FormField
        id="delete-confirm"
        name="confirm"
        label={`Type ${email} to confirm`}
        autoComplete="off"
        required
      />
    </ConfirmDialog>
  );
}
