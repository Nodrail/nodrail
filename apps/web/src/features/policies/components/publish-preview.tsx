"use client";

import { RepositoryPublishWarning } from "./repository-policy";
import { Card } from "@/components/app/card";
import type { ImpactChange } from "@/contracts/v1/policy-impact";
import { impactText } from "../summary";
import type { ImpactState } from "../use-impact";

function stateText(
  kind: ImpactChange["kind"],
  state: ImpactState,
  environmentName: string,
) {
  if (state.status === "ready")
    return impactText(kind, state.impact, environmentName);
  if (state.status === "failed")
    return "Couldn't check the last 7 days. You can still publish.";
  return "Checking what it would have matched in the last 7 days…";
}

/**
 * Above a policy form's publish button: that saving publishes at once, what
 * a rule will do in one sentence, and what the entry would have done to the
 * last days' actions.
 */
export function PublishPreview({
  kind,
  state,
  environmentName,
  summary,
}: {
  kind: ImpactChange["kind"];
  state: ImpactState;
  environmentName: string;
  /** A rule's sentence; null until it can be written, absent for others. */
  summary?: string | null;
}) {
  return (
    <Card
      title="Before you publish"
      description={`Saving publishes to ${environmentName} at once: its next checks use it.`}
      tour="policy-impact"
    >
      {summary === undefined ? null : (
        <p
          data-slot="rule-summary"
          className="mb-2 text-ui font-medium text-foreground"
        >
          {summary ?? "Choose a decision to see what this rule will do."}
        </p>
      )}
      <p data-slot="policy-impact" role="status" className="text-ui text-body">
        {stateText(kind, state, environmentName)}
      </p>
      <RepositoryPublishWarning />
    </Card>
  );
}
