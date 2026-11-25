"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import type { ActionResult } from "@/components/app/action-result";
import { Card } from "@/components/app/card";
import { FormError, SubmitButton } from "@/components/app/form-feedback";
import { FormHint } from "@/components/app/note";
import { useAppAction } from "@/components/app/use-app-action";
import { Button } from "@/components/ui/button";
import type { PolicyFilePreviewDto } from "@/contracts/v1/policies";
import { reviewPolicyFile } from "../policy-api";
import { useLeaveGuard } from "../use-leave-guard";
import { lintPolicyYaml, reviewProblems, sortProblems } from "../yaml-lint";
import { PolicyFilePreview } from "./policy-file-preview";
import { PolicyProblems } from "./policy-problems";
import { YamlGroupBar } from "./yaml-group-bar";
import type { GroupState } from "./yaml-groups";
import { YamlLegend } from "./yaml-legend";
// Imported, not lazy: a lazy editor shows a placeholder first, and React then
// holds the real one back for 300 ms. The YAML page carries the editor's code.
import YamlCodeEditor, { type YamlEditorHandle } from "./yaml-code-editor";

const LINT_DELAY_MS = 300;
const PROBLEMS_ID = "rules-yaml-problems";
const EDITOR_ID = "rules-yaml-editor";
const HINT_ID = "rules-yaml-keys";

/** The text, once you stop typing for a moment. */
function useSettled(text: string) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), LINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return settled;
}

type Reviewed = PolicyFilePreviewDto & { text: string };

/** The server's preview, kept with the text it was made from. */
function useReview(workspace: string, environment: string) {
  return useAppAction<Reviewed>(
    async (_previous, data): Promise<ActionResult<Reviewed>> => {
      const rules = data.get("rules");
      const text = typeof rules === "string" ? rules : "";
      const result = await reviewPolicyFile({ workspace, environment }, text);
      if (result.status === "ok" && result.data)
        return { status: "ok", data: { ...result.data, text } };
      return result.status === "error" ? result : { status: "idle" };
    },
  );
}

/** The text being edited, what both checks found in it, and its review. */
function useDraft(initialText: string, workspace: string, environment: string) {
  const [text, setText] = useState(initialText);
  const settled = useSettled(text);
  const [state, review, pending] = useReview(workspace, environment);
  const local = useMemo(() => lintPolicyYaml(settled), [settled]);
  const reviewed =
    state.status === "ok" && state.data?.text === text ? state.data : null;
  const problems = useMemo(
    () =>
      sortProblems([...local, ...(reviewed ? reviewProblems(reviewed) : [])]),
    [local, reviewed],
  );
  return {
    text,
    setText,
    review: { state, submit: review, pending },
    reviewed,
    problems,
    hasErrors: problems.some((problem) => problem.severity === "error"),
    checking: settled !== text,
    dirty: text.replace(/\r\n?/g, "\n") !== initialText,
  };
}

type Draft = ReturnType<typeof useDraft>;

/** Review sends the text to the server; nothing is published until confirmed. */
function ReviewForm({
  draft,
  onDiscard,
}: {
  draft: Draft;
  onDiscard: () => void;
}) {
  const { state, submit, pending } = draft.review;
  return (
    <ActionForm
      action={submit}
      data-tour="yaml-review"
      className="mt-3.5 grid gap-2"
    >
      <input type="hidden" name="rules" value={draft.text} />
      <FormError state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton
          pending={pending}
          pendingLabel="Reviewing…"
          disabled={draft.checking || draft.hasErrors}
        >
          Review changes
        </SubmitButton>
        <Button
          type="button"
          variant="outline"
          disabled={!draft.dirty}
          onClick={onDiscard}
        >
          Discard edits
        </Button>
      </div>
    </ActionForm>
  );
}

/** The editor with its group buttons above and its legend and keys below. */
function EditorArea({
  draft,
  editor,
  canWrite,
}: {
  draft: Draft;
  editor: RefObject<YamlEditorHandle | null>;
  canWrite: boolean;
}) {
  const [groups, setGroups] = useState<GroupState[]>([]);
  return (
    <div data-tour="yaml-editor">
      <YamlGroupBar
        groups={groups}
        controls={EDITOR_ID}
        onToggle={(kind) => editor.current?.toggleGroup(kind)}
      />
      <YamlCodeEditor
        id={EDITOR_ID}
        value={draft.text}
        onChange={draft.setText}
        onGroups={setGroups}
        problems={draft.problems}
        readOnly={!canWrite}
        label={canWrite ? "Rules as YAML" : "Rules as YAML, read only"}
        describedBy={`${PROBLEMS_ID}-summary ${HINT_ID}`}
        handle={editor}
      />
      <YamlLegend />
      <FormHint id={HINT_ID} className="mt-1.5">
        Tab indents by two spaces. Press Escape, then Tab, to leave the editor.
        To fold the entry at the cursor press Ctrl+Shift+[ (⌘⌥[ on a Mac), and
        Ctrl+Shift+] (⌘⌥]) to open it; the arrows by the line numbers do the
        same. The group buttons above fold whole groups.
      </FormHint>
    </div>
  );
}

/**
 * Every rule in the environment as one YAML file. It is checked as you type,
 * reviewed against the live rules on the server, then published as a whole.
 * Without `policies:write` it is the same file, read only.
 */
export function PolicyYamlEditor({
  workspace,
  environment,
  policiesPath,
  initialText,
  canWrite,
}: {
  workspace: string;
  environment: string;
  policiesPath: string;
  initialText: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const editor = useRef<YamlEditorHandle | null>(null);
  const [published, setPublished] = useState(false);
  const draft = useDraft(initialText, workspace, environment);
  useLeaveGuard(canWrite && draft.dirty && !published);

  return (
    // One column that never grows past the page: long lines scroll in the editor.
    <div className="grid grid-cols-1 gap-3">
      <Card
        title="rules.yaml"
        description={
          canWrite
            ? "Publishing makes this environment match the file: rules not in it are removed."
            : "You can read these rules. People who manage policies can change them."
        }
      >
        <EditorArea draft={draft} editor={editor} canWrite={canWrite} />
        <div data-tour="yaml-problems">
          <PolicyProblems
            id={PROBLEMS_ID}
            problems={draft.problems}
            onSelect={(problem) =>
              editor.current?.reveal(problem.line, problem.column)
            }
          />
        </div>
        {canWrite ? (
          <ReviewForm
            draft={draft}
            onDiscard={() => draft.setText(initialText)}
          />
        ) : null}
      </Card>
      {canWrite && draft.reviewed && !draft.hasErrors ? (
        <PolicyFilePreview
          workspace={workspace}
          environment={environment}
          text={draft.reviewed.text}
          preview={draft.reviewed}
          title="Review"
          showIssues={false}
          onApplied={() => {
            track("yaml_edited");
            setPublished(true);
            router.push(policiesPath);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
