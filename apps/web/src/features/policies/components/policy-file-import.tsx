"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
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

type ReviewedImport = { version: number; preview: PolicyFilePreviewDto };

function useImportPreview(
  place: Parameters<typeof reviewPolicyFile>[0],
  initialText: string,
  previewOnLoad: boolean,
) {
  const preview = useAppAction<ReviewedImport>(async (_previous, data) => {
    const rules = data.get("rules");
    const yaml = typeof rules === "string" ? rules : "";
    const version = Number(data.get("version"));
    const result = await reviewPolicyFile(place, yaml);
    return result.status === "ok" && result.data
      ? { status: "ok", data: { version, preview: result.data } }
      : result.status === "error"
        ? result
        : {
            status: "error",
            message: "Preview the file again before publishing.",
          };
  });
  usePreviewOnLoad(previewOnLoad, initialText, preview[1]);
  return preview;
}

function useImportDraft(initialText: string) {
  const revision = useRef(0);
  const [draft, setDraft] = useState({
    text: initialText,
    version: 0,
    reading: false,
    error: "",
  });
  function edit(text: string) {
    setDraft({ text, version: ++revision.current, reading: false, error: "" });
  }
  async function upload(file: File) {
    const version = ++revision.current;
    setDraft((current) => ({ ...current, version, reading: true, error: "" }));
    try {
      const text = await file.text();
      if (version === revision.current) {
        setDraft({ text, version, reading: false, error: "" });
      }
    } catch {
      if (version === revision.current) {
        setDraft((current) => ({
          ...current,
          reading: false,
          error: "Couldn't read the file. Choose it again or paste its YAML.",
        }));
      }
    }
  }
  return { ...draft, edit, upload };
}

function RulesFileUpload({ onUpload }: { onUpload: (file: File) => void }) {
  return (
    <>
      <FieldLabel htmlFor="rules-upload">Upload a file</FieldLabel>
      <Input
        id="rules-upload"
        className="max-w-full cursor-pointer bg-card shadow-none file:cursor-pointer"
        type="file"
        accept=".yaml,.yml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUpload(file);
          event.target.value = "";
        }}
      />
    </>
  );
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
  const draft = useImportDraft(initialText);
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
          <input type="hidden" name="version" value={draft.version} />
          <RulesFileUpload onUpload={(file) => void draft.upload(file)} />
          <TextAreaField
            id="rules"
            name="rules"
            label="Or paste YAML"
            rows={14}
            spellCheck={false}
            required
            value={draft.text}
            onChange={(event) => draft.edit(event.target.value)}
          />
          <FormFooter
            state={
              draft.error ? { status: "error", message: draft.error } : state
            }
          >
            <SubmitButton
              data-tour="import-check"
              pending={pending || draft.reading}
              pendingLabel={draft.reading ? "Reading…" : "Checking…"}
            >
              Preview
            </SubmitButton>
          </FormFooter>
        </ActionForm>
      </Card>
      {!pending &&
      state.status === "ok" &&
      state.data?.version === draft.version ? (
        <div data-tour="import-preview">
          <PolicyFilePreview
            workspace={workspace}
            environment={environment}
            text={draft.text}
            preview={state.data.preview}
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
