"use client";

import { useRepositoryProject } from "./repository-policy";

import { useRouter } from "next/navigation";
import { track } from "@/components/analytics/posthog";
import type { ActionResult } from "@/components/app/action-result";
import { FormFooter, SubmitButton } from "@/components/app/form-feedback";
import { useAppAction } from "@/components/app/use-app-action";
import type { RunPolicyChange } from "@/contracts/v1/runs";
import { changeRunPolicyAction } from "../actions";
import { useFormEntry, useImpact } from "../use-impact";
import { PublishPreview } from "./publish-preview";

// What the gate and budget forms share: saving, its feedback, the impact
// preview, and the two ways a gate or budget holds an action.

export type Where = {
  workspace: string;
  environment: string;
  /** The environment's name, as the publish button says it. */
  environmentName: string;
  /** The live version the page was read from. */
  revision: number;
  /** Where to go once saved: the Gates or Budgets tab. */
  listPath: string;
};

/**
 * Saves one gate or budget built from the form, then returns to the list.
 * Watches the form meanwhile, for the impact preview.
 */
export function useSave(
  where: Where,
  change: Pick<RunPolicyChange, "kind" | "id">,
  fromForm: (data: FormData) => unknown,
) {
  const router = useRouter();
  const project = useRepositoryProject();
  const [state, submit, pending] = useAppAction(
    (_previous, data) =>
      changeRunPolicyAction(
        where.workspace,
        where.environment,
        { ...change, entry: fromForm(data) } as RunPolicyChange,
        where.revision,
        project?.id ?? null,
      ),
    () => {
      track(`${change.kind}_${change.id ? "updated" : "created"}`);
      router.push(where.listPath);
    },
  );
  const entry = useFormEntry(fromForm, pending);
  const impact = useImpact(where, change, entry);
  return {
    state,
    submit: entry.submitWith(submit),
    pending,
    form: { ref: entry.form, onChange: entry.read },
    preview: (
      <PublishPreview
        kind={change.kind}
        state={impact}
        environmentName={where.environmentName}
      />
    ),
  };
}

/** The submit button's words: saving publishes to the environment at once. */
export const publishLabel = (editing: boolean, environmentName: string) =>
  `${editing ? "Save" : "Create"} and publish to ${environmentName}`;

/** The form's error, and its one submit button. */
export function SaveFooter({
  state,
  pending,
  label,
  environmentName,
}: {
  state: ActionResult<unknown>;
  pending: boolean;
  label: string;
  environmentName: string;
}) {
  return (
    <FormFooter state={state}>
      <SubmitButton
        size="lg"
        pending={pending}
        pendingLabel={`Publishing to ${environmentName}…`}
      >
        {label}
      </SubmitButton>
    </FormFooter>
  );
}
