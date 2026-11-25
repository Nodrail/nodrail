import { z } from "zod";

/** The screens with a guided tour. */
export const tourKeys = [
  "policies",
  "activity",
  "insights",
  "inventory",
  "settings",
  "account",
  "policies-yaml",
  "import",
  "rule",
  "run-policy",
  "agents",
  "agent",
  "connect",
  "overview",
  "run",
  "event",
] as const;
export type TourKey = (typeof tourKeys)[number];

/**
 * The only tour that opens by itself, the first time: the screen people
 * start from. Every other tour waits in Help, "Take the tour of this page",
 * or behind the help button of a dialog or panel.
 */
export const autoTours: readonly TourKey[] = ["overview"];

/** The first steps of a new workspace, in the order they are listed. */
export const firstStepKeys = ["agent", "rule", "decision", "teammate"] as const;
export type FirstStepKey = (typeof firstStepKeys)[number];
export type FirstStepsDto = Record<FirstStepKey, boolean>;

/** Whether every first step is done. */
export const allStepsDone = (steps: FirstStepsDto) =>
  firstStepKeys.every((key) => steps[key]);

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Every guidance key a person can record, and nothing else:
 * `tour:<screen>` once a tour has been shown, `tours_off` once they asked for
 * no tour to open by itself, `whats_new` with the last entry read,
 * `checklist:<workspace>` once the first steps are set aside, and
 * `checklist:<workspace>:<step>` once a step was seen done.
 */
export const guidanceKey = z
  .string()
  .regex(
    new RegExp(
      `^(tour:(${tourKeys.join("|")})|tours_off|whats_new|checklist:${uuid}(:(${firstStepKeys.join("|")}))?)$`,
    ),
  );

export const guidanceMark = z.object({
  key: guidanceKey,
  value: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .nullable()
    .default(null),
});
export type GuidanceMark = z.input<typeof guidanceMark>;

/** What a person has seen, by key; the value where the key keeps one. */
export type GuidanceDto = Record<string, string | null>;

export const tourGuidanceKey = (tour: TourKey) => `tour:${tour}`;
export const WHATS_NEW_KEY = "whats_new";
export const TOURS_OFF_KEY = "tours_off";
export const checklistKey = (workspaceId: string, step?: FirstStepKey) =>
  step ? `checklist:${workspaceId}:${step}` : `checklist:${workspaceId}`;
