"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import { StatusMessage } from "@/components/app/status-message";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/app/form-field";
import { authForm } from "@/features/auth/components/auth-form";
import { createWorkspaceAction, type CreateWorkspaceState } from "../actions";
import { appPath } from "@/lib/product-path";

const initial: CreateWorkspaceState = { status: "idle" };

const messages = {
  invalid: "Enter a name of up to 120 characters.",
  unavailable: "We could not create the workspace. Please try again.",
};

export function CreateWorkspaceForm() {
  const router = useRouter();
  // The server answers instead of redirecting, so success can be recorded here.
  const [state, action, pending] = useActionState(
    async (previous: CreateWorkspaceState, data: FormData) => {
      const result = await createWorkspaceAction(previous, data);
      if (result.status === "created") {
        track("workspace_created", { workspace_id: result.workspaceId });
        router.push(appPath(result.slug));
      }
      return result;
    },
    initial,
  );
  const created = state.status === "created";
  const error =
    state.status === "idle" || created ? null : messages[state.status];
  return (
    <ActionForm action={action} className={authForm}>
      <FormField
        id="name"
        name="name"
        label="Workspace name"
        placeholder="Your team or project"
        maxLength={120}
        required
        error={error}
      />
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || created}
      >
        {pending || created ? "Creating…" : "Create workspace"}
      </Button>
      <StatusMessage show={created} className="text-ui text-body">
        Workspace created. Opening it…
      </StatusMessage>
    </ActionForm>
  );
}
