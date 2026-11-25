// The entries of a rules file by kind, for the YAML editor's groups, colors
// and folds. Read from the text as you type, so it works on a file that
// doesn't compile yet.

export const outlineKinds = ["rule", "gate", "budget"] as const;
export type OutlineKind = (typeof outlineKinds)[number];

export type OutlineItem = {
  kind: OutlineKind;
  name: string;
  /** First and last line of the entry, from 1, trailing blank lines left out. */
  line: number;
  endLine: number;
  /** A rule's effect as written, when it says one. */
  effect?: "allow" | "deny";
};

const EFFECT = /^(?:-\s+|\s{2})effect:\s*["']?(allow|deny)["']?\s*(?:#.*)?$/;

const ITEM_START = /^-(\s|$)/;
const KEY = /^(?:-\s+|\s{2})(rule|gate|budget):\s*(.*)$/;

/** "'QA gate'" → "QA gate". Only a plain or quoted scalar; anything else stays. */
function scalar(raw: string) {
  const value = raw.replace(/\s+#.*$/, "").trim();
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

/** Each rule, gate and budget of the file's top-level list, in file order. */
export function outlineItems(text: string): OutlineItem[] {
  const lines = text.split(/\r\n?|\n/);
  const items: OutlineItem[] = [];
  let open: OutlineItem | null = null;
  let last = 0;
  const close = () => {
    if (open) items.push({ ...open, endLine: Math.max(open.line, last) });
    open = null;
  };
  lines.forEach((text, index) => {
    const number = index + 1;
    if (ITEM_START.test(text)) {
      close();
      open = { kind: "rule", name: "", line: number, endLine: number };
      last = number;
      kindOf(open, text);
      effectOf(open, text);
      return;
    }
    if (!open) return;
    // Something at column 0 that isn't a comment ends the list.
    if (/^\S/.test(text) && !text.startsWith("#")) return close();
    if (text.trim() && !text.trim().startsWith("#")) {
      last = number;
      if (!open.name) kindOf(open, text);
      effectOf(open, text);
    }
  });
  close();
  return items.filter((item) => item.name);
}

function kindOf(item: OutlineItem, text: string) {
  const found = KEY.exec(text);
  if (!found) return;
  item.kind = found[1] as OutlineKind;
  item.name = scalar(found[2] ?? "") || "(unnamed)";
}

function effectOf(item: OutlineItem, text: string) {
  const found = EFFECT.exec(text);
  if (found) item.effect = found[1] as OutlineItem["effect"];
}

/** Items by kind, keeping file order within each. */
export function groupOutline(items: OutlineItem[]) {
  return outlineKinds.map((kind) => ({
    kind,
    items: items.filter((item) => item.kind === kind),
  }));
}
