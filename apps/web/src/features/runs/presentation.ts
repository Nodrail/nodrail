import type { Tone } from "@/components/app/tones";
import { outcomeLabels } from "@/contracts/v1/glossary";
import {
  evaluationLabels,
  type RunActionDto,
  type RunStepDto,
} from "@/contracts/v1/runs";

export const evaluationTones: Record<RunActionDto["evaluation"], Tone> = {
  ready: "success",
  denied: "danger",
};

/**
 * How an action in a run was decided: "Held" for a gate or budget that
 * denied it, otherwise what the rules said.
 */
export function actionOutcome(action: RunActionDto): {
  tone: Tone;
  label: string;
} {
  if (action.hold) return { tone: "warning", label: outcomeLabels.held };
  return {
    tone: evaluationTones[action.evaluation],
    label: evaluationLabels[action.evaluation],
  };
}

/** A verdict is what the agent reported; a step with none never meets a gate. */
export function reportTone(finished: boolean, verdict: string | null): Tone {
  if (!finished) return "neutral";
  if (verdict === null) return "warning";
  return /^(pass|ship|done|ok|approved)/.test(verdict) ? "success" : "danger";
}

export const verdictTone = (step: RunStepDto): Tone =>
  reportTone(step.finishedAt !== null, step.verdict);

export const verdictText = (step: RunStepDto) =>
  step.finishedAt ? (step.verdict ?? "No verdict") : "Running";

export const runPath = (base: string, id: string) =>
  `${base}/activity/runs/${id}`;
