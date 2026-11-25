"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import { Card } from "@/components/app/card";
import { FormFooter, SubmitButton } from "@/components/app/form-feedback";
import { FieldLabel, TextAreaField } from "@/components/app/form-field";
import { useAppAction } from "@/components/app/use-app-action";
import { Input } from "@/components/ui/input";
import type { PolicyFilePreviewDto } from "@/contracts/v1/policies";
import { reviewPolicyFile } from "../policy-api";
import { PolicyFilePreview } from "./policy-file-preview";

/** Previews the starting text once, as copying from an environment does. */
function usePreviewOnLoad(
  enabled: boolean,
  text: string,
  preview: (data: FormData) => void,
) {
  const [, startTransition] = useTransition();
  useEffect(() => {
    if (!enabled) return;
    const data = new FormData();
    data.set("rules", text);
    startTransition(() => preview(data));
    // Once, for the text the page opened with.
  }, []);
}

function useImportPreview(
  place: Parameters<typeof reviewPolicyFile>[0],
  initialText: string,
  previewOnLoad: boolean,
) {
  const preview = useAppAction<PolicyFilePreviewDto>((_previous, data) => {
    const yaml = data.get("rules");
    return reviewPolicyFile(place, typeof yaml === "string" ? yaml : "");
  });
  usePreviewOnLoad(previewOnLoad, initialText, preview[1]);
  return preview;
}

export function PolicyFileImport({
  workspace,
  environment,
  policiesPath,
  initialText,
  previewOnLoad = false,
}: {
  workspace: string;
  environment: string;
  policiesPath: string;
  initialText: string;
  /** Preview the starting text at once, as copying from an environment does. */
  previewOnLoad?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [state, preview, pending] = useImportPreview(
    { workspace, environment },
    initialText,
    previewOnLoad,
  );
  return (
    <div className="grid gap-3">
      <Card
        title="Rules file"
        tour="import-file"
        description="Rules in this environment that are not in the file are removed."
      >
        <ActionForm action={preview} className="grid gap-3.5">
          <FieldLabel htmlFor="rules-upload">Upload a file</FieldLabel>
          <Input
            id="rules-upload"
            className="max-w-full cursor-pointer bg-card shadow-none file:cursor-pointer"
            type="file"
            accept=".yaml,.yml"
            onChange={(event) => {
              void event.target.files?.[0]?.text().then(setText);
            }}
          />
          <TextAreaField
            id="rules"
            name="rules"
            label="Or paste YAML"
            rows={14}
            spellCheck={false}
            required
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <FormFooter state={state}>
            <SubmitButton
              data-tour="import-check"
              pending={pending}
              pendingLabel="Checking…"
            >
              Preview
            </SubmitButton>
          </FormFooter>
        </ActionForm>
      </Card>
      {state.status === "ok" && state.data ? (
        <div data-tour="import-preview">
          <PolicyFilePreview
            workspace={workspace}
            environment={environment}
            text={text}
            preview={state.data}
            onApplied={() => {
              track("yaml_imported");
              router.push(policiesPath);
              router.refresh();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
