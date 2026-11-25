/**
 * The product's status tones, one vocabulary for every surface: badges,
 * notes and callouts, banners, bars and dots. A screen picks a tone by what
 * the thing means, never by the colour it wants:
 *
 * - `success`: done or allowed.
 * - `info`: worth knowing, nothing to do (blue-grey, never green).
 * - `warning`: waits for someone, or is close to a limit. Held work too.
 * - `danger`: denied, failed, or a limit reached.
 * - `neutral`: finished without a verdict (expired, closed, paused, idle).
 */
export type Tone = "success" | "info" | "warning" | "danger" | "neutral";

export const tones: readonly Tone[] = [
  "success",
  "info",
  "warning",
  "danger",
  "neutral",
];

type ToneLook = {
  /** A soft fill with the tone's strong text: badges, notes, callouts. */
  soft: string;
  /** The tone's text colour alone, readable on white (4.5:1 or more). */
  text: string;
  /** The solid colour, for dots, bars and meters. */
  fill: string;
  /** The border around a soft box. */
  border: string;
  /** The same colours as CSS values, for styles outside Tailwind (CodeMirror). */
  vars: { fill: string; text: string; soft: string };
};

export const toneLooks: Record<Tone, ToneLook> = {
  success: {
    soft: "bg-success-soft text-success",
    text: "text-success",
    fill: "bg-success",
    border: "border-success/25",
    vars: {
      fill: "var(--success)",
      text: "var(--success)",
      soft: "var(--success-soft)",
    },
  },
  info: {
    soft: "bg-info-soft text-info",
    text: "text-info",
    fill: "bg-info",
    border: "border-info/25",
    vars: {
      fill: "var(--info)",
      text: "var(--info)",
      soft: "var(--info-soft)",
    },
  },
  warning: {
    soft: "bg-warning-soft text-warning-strong",
    text: "text-warning-strong",
    fill: "bg-warning",
    border: "border-warning/25",
    vars: {
      fill: "var(--warning)",
      text: "var(--warning-strong)",
      soft: "var(--warning-soft)",
    },
  },
  danger: {
    soft: "bg-danger-soft text-destructive",
    text: "text-destructive",
    fill: "bg-destructive",
    border: "border-destructive/25",
    vars: {
      fill: "var(--destructive)",
      text: "var(--destructive)",
      soft: "var(--danger-soft)",
    },
  },
  neutral: {
    soft: "bg-muted text-muted-foreground",
    text: "text-muted-foreground",
    fill: "bg-muted-foreground/40",
    border: "border-border",
    vars: {
      fill: "var(--muted-foreground)",
      text: "var(--muted-foreground)",
      soft: "var(--muted)",
    },
  },
};
