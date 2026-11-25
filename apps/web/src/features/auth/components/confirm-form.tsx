"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/app/form-field";
import { FieldError } from "@/components/app/note";
import { authForm, retryMessage } from "./auth-form";
import { confirmSignIn, type ConfirmState } from "../actions";
import { SubmitButton } from "@/components/app/form-feedback";

const initial: ConfirmState = { status: "idle" };

export function ConfirmForm({
  token,
  reset,
}: {
  token: string;
  reset?: boolean;
}) {
  const [state, action, pending] = useActionState(confirmSignIn, initial);

  if (state.status === "failed")
    return (
      <div className={authForm}>
        <FieldError>This link has expired or was already used.</FieldError>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Get a new link</Link>
        </Button>
      </div>
    );

  return (
    <form action={action} className={authForm}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="mode" value={reset ? "reset" : "sign-in"} />
      {reset && (
        <FormField
          id="password"
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={256}
          required
          error={
            state.status === "password" ? "Use at least 12 characters." : null
          }
        />
      )}
      {state.status === "retry" && <FieldError>{retryMessage}</FieldError>}
      <SubmitButton
        size="lg"
        className="w-full"
        pending={pending}
        pendingLabel="Signing in…"
      >
        {reset ? "Set password and sign in" : "Continue to Nodrail"}
      </SubmitButton>
    </form>
  );
}
