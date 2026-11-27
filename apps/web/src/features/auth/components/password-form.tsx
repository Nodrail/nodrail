"use client";

import { useActionState } from "react";
import { ActionForm } from "@/components/app/action-form";
import { FormField } from "@/components/app/form-field";
import { SubmitButton } from "@/components/app/form-feedback";
import { FieldError } from "@/components/app/note";
import { signInWithPassword, type PasswordState } from "../actions";
import { authForm, signInProblem } from "./auth-form";

const initial: PasswordState = { status: "idle" };

export function PasswordForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInWithPassword, initial);
  const problem = signInProblem(state.status);

  return (
    <ActionForm action={action} className={authForm}>
      <input type="hidden" name="next" value={next} />
      <FormField
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
        maxLength={254}
        required
      />
      <FormField
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        maxLength={256}
        required
      />
      {state.status === "failed" && (
        <FieldError>
          Sign-in failed. Check your email and password or try again later.
        </FieldError>
      )}
      {problem && <FieldError>{problem}</FieldError>}
      <SubmitButton
        size="lg"
        className="w-full"
        pending={pending}
        pendingLabel="Signing in…"
      >
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
