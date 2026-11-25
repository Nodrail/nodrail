"use client";

import { useActionState } from "react";
import { FieldError } from "@/components/app/note";
import { authForm } from "@/features/auth/components/auth-form";
import { acceptInviteAction } from "../actions";
import { SubmitButton } from "@/components/app/form-feedback";

/** A POST, so a mail scanner fetching the link cannot accept it. */
export function AcceptInviteForm({
  token,
  workspace,
}: {
  token: string;
  workspace: string;
}) {
  const [state, action, pending] = useActionState(
    () => acceptInviteAction(token),
    null,
  );
  return (
    <form action={action} className={authForm}>
      {state ? <FieldError>{state.error}</FieldError> : null}
      <SubmitButton
        size="lg"
        className="w-full"
        pending={pending}
        pendingLabel="Joining…"
      >
        Join {workspace}
      </SubmitButton>
    </form>
  );
}
