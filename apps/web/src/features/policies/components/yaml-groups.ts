import { foldService } from "@codemirror/language";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  gutter,
  type DecorationSet,
} from "@codemirror/view";
import {
  groupLabel,
  lookOf,
  legendLooks,
  type EntryLook,
} from "../entry-looks";
import {
  groupOutline,
  outlineItems,
  type OutlineItem,
  type OutlineKind,
} from "../yaml-outline";

// The rules file grouped inside the editor: a heading before the rules, the
// gates and the budgets that folds its whole group into that one line, an arrow by each entry's
// line number that folds the entry, and a colored bar and badge saying what
// each entry does. All read from the text, so they follow every keystroke.

/** The entries, and each group's first and last line, for the current text. */
const entries = StateField.define<OutlineItem[]>({
  create: (state) => outlineItems(state.doc.toString()),
  update: (items, tr) =>
    tr.docChanged ? outlineItems(tr.state.doc.toString()) : items,
});

/** A group's lines, whole, from its first entry to its last. */
function groupRange(state: EditorState, items: OutlineItem[]) {
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return null;
  return {
    from: state.doc.line(first.line).from,
    to: state.doc.line(Math.min(last.endLine, state.doc.lines)).to,
  };
}

/** Folds a group, or opens it again. */
export const toggleGroupEffect = StateEffect.define<OutlineKind>();
/** Opens the group holding this position, so the cursor can go there. */
export const showGroupAt = StateEffect.define<number>();

/**
 * The groups folded by their heading. Kept apart from the editor's own folds:
 * a folded group is one heading line, never a heading over a "…" line.
 */
const foldedGroups = StateField.define<OutlineKind[]>({
  create: () => [],
  update(kinds, tr) {
    let next = kinds;
    for (const effect of tr.effects) {
      if (effect.is(toggleGroupEffect))
        next = next.includes(effect.value)
          ? next.filter((kind) => kind !== effect.value)
          : [...next, effect.value];
      if (effect.is(showGroupAt)) {
        const line = tr.state.doc.lineAt(effect.value).number;
        const item = tr.state
          .field(entries)
          .find((entry) => entry.line <= line && line <= entry.endLine);
        if (item) next = next.filter((kind) => kind !== item.kind);
      }
    }
    return next;
  },
});

const svgNs = "http://www.w3.org/2000/svg";

/** Lucide's chevron, drawn by hand: CodeMirror widgets are plain DOM. */
function chevron(folded: boolean) {
  const icon = document.createElementNS(svgNs, "svg");
  for (const [name, value] of Object.entries({
    class: "cm-policy-chevron",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    icon.setAttribute(name, value);
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", folded ? "m9 18 6-6-6-6" : "m6 9 6 6 6-6");
  icon.append(path);
  return icon;
}

/** A group of the file, as the toolbar over the editor offers it. */
export type GroupState = {
  kind: OutlineKind;
  label: string;
  count: number;
  folded: boolean;
};

/** The groups with entries in the text, and whether each is folded. */
export function groupStates(state: EditorState): GroupState[] {
  const folded = state.field(foldedGroups);
  return groupOutline(state.field(entries))
    .filter(({ items }) => items.length)
    .map(({ kind, items }) => ({
      kind,
      label: groupLabel(kind)[0],
      count: items.length,
      folded: folded.includes(kind),
    }));
}

/** Whether a change may have changed the groups or their folds. */
export const groupsChanged = (
  before: EditorState,
  after: EditorState,
): boolean =>
  before.field(entries) !== after.field(entries) ||
  before.field(foldedGroups) !== after.field(foldedGroups);

/**
 * "▾ RULES · 5": folds its group with the mouse. Inside the text area it is
 * hidden from assistive technology and the keyboard; the toolbar above the
 * editor offers the same folds as buttons of its own.
 */
class GroupHeading extends WidgetType {
  constructor(
    readonly kind: OutlineKind,
    readonly count: number,
    readonly folded: boolean,
  ) {
    super();
  }

  eq(other: GroupHeading) {
    return (
      other.kind === this.kind &&
      other.count === this.count &&
      other.folded === this.folded
    );
  }

  toDOM(view: EditorView) {
    const [label, noun] = groupLabel(this.kind);
    const heading = document.createElement("div");
    heading.className = "cm-policy-group";
    heading.setAttribute("aria-hidden", "true");
    heading.dataset.group = this.kind;
    heading.dataset.expanded = String(!this.folded);
    heading.append(chevron(this.folded), `${label} · ${this.count}`);
    if (this.folded) {
      const hidden = document.createElement("span");
      hidden.className = "cm-policy-group-hidden";
      hidden.textContent = ` ${this.count} ${noun}${this.count === 1 ? "" : "s"} folded`;
      heading.append(hidden);
    }
    heading.addEventListener("mousedown", (event) => event.preventDefault());
    heading.addEventListener("click", () =>
      view.dispatch({ effects: toggleGroupEffect.of(this.kind) }),
    );
    return heading;
  }

  ignoreEvent() {
    return true;
  }
}

/** The badge after an entry's first line. */
class Badge extends WidgetType {
  constructor(readonly look: EntryLook) {
    super();
  }

  eq(other: Badge) {
    return other.look.key === this.look.key;
  }

  toDOM() {
    const badge = document.createElement("span");
    badge.className = `cm-policy-badge cm-policy-${this.look.key}`;
    badge.textContent = this.look.label;
    badge.setAttribute("aria-hidden", "true");
    return badge;
  }
}

/** Headings and badges; block widgets must come from a state field. */
const decorations = StateField.define<DecorationSet>({
  create: (state) => build(state),
  update: (set, tr) =>
    tr.docChanged ||
    tr.startState.field(foldedGroups) !== tr.state.field(foldedGroups)
      ? build(tr.state)
      : set,
  provide: (field) => EditorView.decorations.from(field),
});

function build(state: EditorState) {
  const items = state.field(entries);
  const folded = state.field(foldedGroups);
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  for (const { kind, items: group } of groupOutline(items)) {
    const range = groupRange(state, group);
    if (!range) continue;
    const shut = folded.includes(kind);
    const widget = new GroupHeading(kind, group.length, shut);
    marks.push(
      shut
        ? { ...range, deco: Decoration.replace({ widget, block: true }) }
        : {
            from: range.from,
            to: range.from,
            deco: Decoration.widget({ widget, block: true, side: -1 }),
          },
    );
  }
  for (const item of items) {
    const look = lookOf(item);
    if (!look || folded.includes(item.kind) || item.line > state.doc.lines)
      continue;
    const at = state.doc.line(item.line).to;
    marks.push({
      from: at,
      to: at,
      deco: Decoration.widget({ widget: new Badge(look), side: 1 }),
    });
  }
  marks.sort((a, b) => a.from - b.from || a.deco.startSide - b.deco.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const mark of marks) builder.add(mark.from, mark.to, mark.deco);
  return builder.finish();
}

class Bar extends GutterMarker {
  constructor(readonly key: string) {
    super();
  }

  eq(other: Bar) {
    return other.key === this.key;
  }

  toDOM() {
    const bar = document.createElement("span");
    bar.className = `cm-policy-bar cm-policy-${this.key}`;
    return bar;
  }
}

/** The colored bar beside each entry's lines. */
const bars = gutter({
  class: "cm-policy-bars",
  lineMarker(view, line) {
    const number = view.state.doc.lineAt(line.from).number;
    const item = view.state
      .field(entries)
      .find((entry) => entry.line <= number && number <= entry.endLine);
    const look = item && lookOf(item);
    return look ? new Bar(look.key) : null;
  },
  lineMarkerChange: (update) => update.docChanged,
});

/** An entry folds from the end of its first line to its last line. */
const entryFolds = foldService.of((state, lineStart) => {
  const number = state.doc.lineAt(lineStart).number;
  const item = state.field(entries).find((entry) => entry.line === number);
  if (!item || item.endLine <= item.line) return null;
  return {
    from: state.doc.line(item.line).to,
    to: state.doc.line(Math.min(item.endLine, state.doc.lines)).to,
  };
});

const theme = EditorView.theme({
  ".cm-policy-bars": { width: "4px" },
  ".cm-policy-bar": { display: "block", height: "100%", width: "3px" },
  ".cm-policy-group": {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: "10px 4px 4px",
    border: "0",
    background: "transparent",
    cursor: "pointer",
    // The eyebrow preset in src/components/app/styles.ts.
    font: "600 var(--text-micro)/1.2 var(--font-sans)",
    letterSpacing: "var(--tracking-label)",
    textTransform: "uppercase",
    color: "var(--muted-foreground)",
  },
  ".cm-policy-group:hover": { color: "var(--foreground)" },
  ".cm-policy-chevron": {
    display: "inline-block",
    width: "12px",
    height: "12px",
    marginRight: "4px",
    verticalAlign: "-2px",
  },
  ".cm-policy-group-hidden": {
    textTransform: "none",
    letterSpacing: "normal",
    fontWeight: "400",
  },
  ".cm-policy-badge": {
    marginLeft: "12px",
    padding: "1px 7px",
    borderRadius: "999px",
    font: "600 var(--text-micro)/1.5 var(--font-sans)",
    verticalAlign: "1px",
  },
  ...Object.fromEntries(
    legendLooks.flatMap(({ key, fill, text, soft }) => [
      [`.cm-policy-bar.cm-policy-${key}`, { backgroundColor: fill }],
      [
        `.cm-policy-badge.cm-policy-${key}`,
        { color: text, backgroundColor: soft },
      ],
    ]),
  ),
});

/** Everything above, for the rules editor. */
export const yamlGroups: Extension = [
  entries,
  foldedGroups,
  decorations,
  bars,
  entryFolds,
  theme,
];
