"use client";

import { yaml } from "@codemirror/lang-yaml";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type StateCommand,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, useState, type RefObject } from "react";
import { problemRanges, type Problem } from "../yaml-lint";
import {
  groupStates,
  groupsChanged,
  showGroupAt,
  toggleGroupEffect,
  yamlGroups,
  type GroupState,
} from "./yaml-groups";

/** What the page can ask of the editor: put the cursor on a problem, fold a group. */
export type YamlEditorHandle = {
  reveal: (line: number, column: number) => void;
  toggleGroup: (kind: GroupState["kind"]) => void;
};

const INDENT = "  ";

/** Tab indents by two spaces; Escape then Tab still leaves the editor. */
const indent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  dispatch(
    state.update(
      state.changeByRange((range) => {
        if (range.empty)
          return {
            changes: { from: range.from, insert: INDENT },
            range: EditorSelection.cursor(range.from + INDENT.length),
          };
        const first = state.doc.lineAt(range.from).number;
        const last = state.doc.lineAt(range.to).number;
        const changes = [];
        for (let number = first; number <= last; number += 1)
          changes.push({ from: state.doc.line(number).from, insert: INDENT });
        const shift = (last - first + 1) * INDENT.length;
        return {
          changes,
          range: EditorSelection.range(
            range.from + INDENT.length,
            range.to + shift,
          ),
        };
      }),
      { userEvent: "input.indent" },
    ),
  );
  return true;
};

const outdent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false;
  const changes = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let number = first; number <= last; number += 1) {
      const line = state.doc.line(number);
      const spaces = /^ {1,2}/.exec(line.text)?.[0].length ?? 0;
      if (spaces) changes.push({ from: line.from, to: line.from + spaces });
    }
  }
  if (changes.length)
    dispatch(state.update({ changes, userEvent: "delete.dedent" }));
  return true;
};

// The product's tokens, so the editor reads as part of the page.
const theme = EditorView.theme({
  "&": {
    fontSize: "0.8125rem",
    color: "var(--body)",
    backgroundColor: "var(--card)",
    border: "1px solid var(--input-strong)",
    borderRadius: "var(--radius)",
    overflow: "hidden",
  },
  "&.cm-focused": {
    outline: "none",
    borderColor: "var(--ring)",
    // The product's focus ring (focusRing): solid, 2px, off the edge by 2px.
    boxShadow: "0 0 0 2px var(--background), 0 0 0 4px var(--ring)",
  },
  // 24px lines, so each fold arrow is a 24px target (WCAG 2.5.8).
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "24px",
    maxHeight: "70vh",
    minHeight: "320px",
  },
  ".cm-foldGutter .cm-gutterElement": {
    minWidth: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-foldGutter .cm-gutterElement > span": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    fontSize: "14px",
    cursor: "pointer",
  },
  ".cm-foldGutter .cm-gutterElement > span:hover": {
    color: "var(--foreground)",
    backgroundColor: "var(--selected)",
    borderRadius: "4px",
  },
  ".cm-content": { caretColor: "var(--foreground)", padding: "8px 0" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--selected) 45%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--selected)",
    color: "var(--foreground)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--highlight)" },
  ".cm-tooltip": {
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
  ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
});

/** Read only also tells assistive technology, not just the keyboard. */
const accessFor = (readOnly: boolean) => [
  EditorState.readOnly.of(readOnly),
  EditorView.contentAttributes.of({ "aria-readonly": String(readOnly) }),
];

type Setup = {
  doc: string;
  readOnly: boolean;
  label: string;
  describedBy?: string;
  access: Compartment;
  onChange: (text: string) => void;
  /** The file's groups, whenever they or their folds change. */
  onGroups: (groups: GroupState[]) => void;
};

function createEditor(parent: HTMLElement, setup: Setup) {
  const { doc, readOnly, label, describedBy, access, onChange, onGroups } =
    setup;
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        yaml(),
        yamlGroups,
        lintGutter(),
        theme,
        EditorState.tabSize.of(2),
        keymap.of([{ key: "Tab", run: indent, shift: outdent }]),
        access.of(accessFor(readOnly)),
        EditorView.contentAttributes.of({
          // Editable text is focusable already; saying so lets checkers see
          // that the scrolling area can be reached by keyboard.
          tabindex: "0",
          "aria-label": label,
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
          if (groupsChanged(update.startState, update.state))
            onGroups(groupStates(update.state));
        }),
      ],
    }),
  });
}

/** Puts the cursor on a line and column, scrolled into the middle. */
function reveal(editor: EditorView, line: number, column: number) {
  const [range] = problemRanges(editor.state.doc.toString(), [
    { line, column, message: "", severity: "error", from: "editor" },
  ]);
  const at = range?.from ?? 0;
  // A folded group opens first, so the cursor isn't left in hidden lines.
  editor.dispatch({ effects: showGroupAt.of(at) });
  editor.dispatch({
    selection: EditorSelection.cursor(at),
    effects: EditorView.scrollIntoView(at, { y: "center" }),
  });
  editor.focus();
}

/** Keeps the editor's text, access and underlines in step with the page. */
function useSync(
  view: RefObject<EditorView | null>,
  access: Compartment,
  {
    value,
    readOnly,
    problems,
  }: Pick<Setup, "readOnly"> & {
    value: string;
    problems: Problem[];
  },
) {
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  }, [view, value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: access.reconfigure(accessFor(readOnly)),
    });
  }, [view, access, readOnly]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const ranges = problemRanges(editor.state.doc.toString(), problems);
    editor.dispatch(setDiagnostics(editor.state, ranges));
  }, [view, problems]);
}

/**
 * CodeMirror 6 with YAML highlighting, line numbers and the lint gutter, the
 * file grouped into rules, gates and budgets that fold, and each entry colored
 * by what it does. The
 * page owns the text and the problems; this only shows them. Loaded with
 * next/dynamic, so no other page downloads it.
 */
export default function YamlCodeEditor({
  value,
  onChange,
  problems,
  readOnly,
  label,
  describedBy,
  handle,
  id,
  onGroups,
}: Pick<
  Setup,
  "readOnly" | "label" | "describedBy" | "onChange" | "onGroups"
> & {
  value: string;
  problems: Problem[];
  handle?: RefObject<YamlEditorHandle | null>;
  /** The editor's id, for controls that act on it. */
  id?: string;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changed = useRef(onChange);
  const grouped = useRef(onGroups);
  const [access] = useState(() => new Compartment());

  useEffect(() => {
    changed.current = onChange;
    grouped.current = onGroups;
  }, [onChange, onGroups]);

  useEffect(() => {
    if (!mount.current) return;
    const editor = createEditor(mount.current, {
      doc: value,
      readOnly,
      label,
      describedBy,
      access,
      onChange: (text) => changed.current(text),
      onGroups: (groups) => grouped.current(groups),
    });
    view.current = editor;
    grouped.current(groupStates(editor.state));
    return () => {
      editor.destroy();
      view.current = null;
    };
    // Created once; later values arrive through useSync.
  }, []);

  useSync(view, access, { value, readOnly, problems });

  useEffect(() => {
    if (!handle) return;
    handle.current = {
      reveal: (line, column) => {
        if (view.current) reveal(view.current, line, column);
      },
      toggleGroup: (kind) =>
        view.current?.dispatch({ effects: toggleGroupEffect.of(kind) }),
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);

  return (
    <div
      ref={mount}
      id={id}
      data-slot="yaml-editor"
      data-readonly={readOnly || undefined}
    />
  );
}
