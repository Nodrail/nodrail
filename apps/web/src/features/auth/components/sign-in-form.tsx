"use client";

import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import { useActionState } from "react";
import { FormField } from "@/components/app/form-field";
import { calloutBox } from "@/components/app/note";
import { cn } from "@/lib/utils";
import { authForm, retryMessage } from "./auth-form";
import { StatusMessage } from "@/components/app/status-message";
import { requestSignInLink, type SignInState } from "../actions";
import { SubmitButton } from "@/components/app/form-feedback";

const initial: SignInState = { status: "idle" };

const messages: Record<
  Exclude<SignInState["status"], "idle" | "sent">,
  string
> = {
  retry: retryMessage,
  invalid: "Enter a valid email address.",
  unavailable: "We could not send the link. Please try again in a moment.",
};

export function SignInForm({
  next,
  submitLabel,
  method = "sign-in",
}: {
  next: string;
  submitLabel: string;
  method?: "sign-in" | "reset" | "verify";
}) {
  const [state, action, pending] = useActionState(
    async (previous: SignInState, data: FormData) => {
      const result = await requestSignInLink(previous, data);
      if (result.status === "sent") track("sign_in_requested");
      return result;
    },
    initial,
  );

  const sent = state.status === "sent";
  const error =
    state.status === "idle" || state.status === "sent"
      ? null
      : messages[state.status];
  return (
    <>
      {/* In the page from the start, so the message is announced when it
          fills, and focused, since the form it replaces had the focus. */}
      <StatusMessage
        show={sent}
        className={cn(calloutBox("success"), "text-sm leading-normal")}
      >
        Check your email. If that address is eligible, a link is on its way.
      </StatusMessage>
      {sent ? null : (
        <ActionForm action={action} className={authForm}>
          <input type="hidden" name="next" value={next} />
          <input type="hidden" name="method" value={method} />
          <FormField
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            placeholder="you@example.com"
            maxLength={254}
            required
            error={error}
          />
          <SubmitButton
            size="lg"
            className="w-full"
            pending={pending}
            pendingLabel="Sending…"
          >
            {submitLabel}
          </SubmitButton>
        </ActionForm>
      )}
    </>
  );
}
