import { toneLooks, type Tone } from "@/components/app/tones";
import { effectLabels, type Effect } from "@/contracts/v1/policies";
import { ruleLabels } from "@/features/activity/presentation";
import type { OutlineItem, OutlineKind } from "./yaml-outline";

/*
 * How each kind of policy entry looks wherever it is drawn: a rule by its
 * effect, a gate and a budget by their kind. The badges in tables, the bars
 * and badges in the YAML editor and the editor's legend all read from here,
 * so a colour or a word changes in one place.
 */

/** A rule effect's tone, for StatusBadge and the editor alike. */
export const effectTones: Record<Effect, Tone> = {
  allow: "success",
  deny: "danger",
};

/** One entry's look: its words and its colours as CSS values. */
export type EntryLook = {
  /** A stable name, for class names and test selectors. */
  key: string;
  label: string;
  /** The bar beside the entry and the legend's swatch. */
  fill: string;
  /** The badge's text, readable (4.5:1) on `soft`. */
  text: string;
  /** The badge's fill. */
  soft: string;
};

const effectLook = (effect: Effect): EntryLook => ({
  key: effect,
  label: effectLabels[effect],
  ...toneLooks[effectTones[effect]].vars,
});

export const entryLooks = {
  allow: effectLook("allow"),
  deny: effectLook("deny"),
  gate: {
    key: "gate",
    label: ruleLabels.gate,
    fill: "var(--gate)",
    text: "var(--gate)",
    soft: "var(--gate-soft)",
  },
  budget: {
    key: "budget",
    label: ruleLabels.budget,
    fill: "var(--budget)",
    text: "var(--budget)",
    soft: "var(--budget-soft)",
  },
} as const satisfies Record<Effect | "gate" | "budget", EntryLook>;

/** The legend's order: the three effects, then gates and budgets. */
export const legendLooks: EntryLook[] = Object.values(entryLooks);

/** How an entry in the rules file looks, or nothing while it has no effect yet. */
export function lookOf(item: OutlineItem): EntryLook | null {
  if (item.kind === "gate") return entryLooks.gate;
  if (item.kind === "budget") return entryLooks.budget;
  return item.effect ? entryLooks[item.effect] : null;
}

/** A group heading's words: "Rules", and "rule" for "3 rules folded". */
export function groupLabel(kind: OutlineKind): [string, string] {
  const singular = ruleLabels[kind];
  return [`${singular}s`, singular.toLowerCase()];
}
