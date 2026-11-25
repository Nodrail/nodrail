import { MAIN_AGENT } from "@nodrail/policy-engine";
import { StatusBadge } from "@/components/app/status-badge";
import { requestReference } from "@/contracts/v1/requests";
import { holdLabel } from "@/contracts/v1/glossary";
import { formatUtc } from "@/lib/time";
import { operationLabel } from "@/contracts/v1/policies";
import type {
  RunActionDto,
  RunEntryDto,
  RunStepDto,
} from "@/contracts/v1/runs";
import { ActivityLink } from "@/features/activity/components/activity-link";
import { ExchangeList } from "@/features/contracts/components/exchange-list";
import { actionOutcome, verdictText, verdictTone } from "../presentation";
import { FormHint } from "@/components/app/note";
import { HostBadge } from "./host-badge";
import { HoldRequirements, RunEntry, RunEntryTitle, RunList } from "./run-list";

function StepEntry({ kind, step }: { kind: string; step: RunStepDto }) {
  return (
    <>
      <RunEntryTitle>
        <strong>{step.agent}</strong>{" "}
        {kind === "started" ? "started" : "finished"}
        <small>
          {step.stepKey} · {step.installationName}
        </small>
      </RunEntryTitle>
      {kind === "finished" ? (
        <p>
          <StatusBadge tone={verdictTone(step)}>
            {verdictText(step)}
          </StatusBadge>
          {step.findings.length ? (
            <small> Findings: {step.findings.join(", ")}</small>
          ) : null}
        </p>
      ) : null}
      {step.exchanges ? <ExchangeList events={step.exchanges} /> : null}
    </>
  );
}

function ActionEntry({
  action,
  mainAgent,
  activityPath,
}: {
  action: RunActionDto;
  mainAgent: string;
  activityPath: string;
}) {
  const outcome = actionOutcome(action);
  return (
    <>
      <RunEntryTitle>
        <strong>
          {action.agent === MAIN_AGENT ? mainAgent : action.agent}
        </strong>{" "}
        asked for{" "}
        {action.toolKey === "claude-code" && action.operationKey === "agent"
          ? `the ${action.resource} agent`
          : `${operationLabel(action)} on ${action.resource}`}
      </RunEntryTitle>
      <p>
        <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
        <HostBadge host={action.host} />
        {action.hold ? (
          <small data-tour="run-held">
            {" "}
            {holdLabel(action.hold.kind, action.hold.name)}
          </small>
        ) : null}
      </p>
      {action.hold?.missing.length ? (
        <HoldRequirements hold={action.hold} />
      ) : null}
      {action.exchanges ? <ExchangeList events={action.exchanges} /> : null}
      {/* One line, so the two links never sit stacked too close to tap. */}
      <FormHint>
        {/* Its event opens in Activity's panel; before one is recorded (an
            allowed action that never asked for its permit), Activity finds
            the request by its reference. */}
        <ActivityLink
          href={
            action.eventId
              ? `${activityPath}?event=${action.eventId}`
              : `${activityPath}?q=${requestReference(action.id)}`
          }
        />
      </FormHint>
    </>
  );
}

/** A run, oldest first: who worked, what they reported, what was held. */
export function RunTimeline({
  entries,
  mainAgent,
  activityPath,
}: {
  entries: RunEntryDto[];
  /** Who acted outside any step: the run's Nodrail agent, when visible. */
  mainAgent: string | null;
  activityPath: string;
}) {
  return (
    <RunList aria-label="Run timeline">
      {entries.map((entry) => (
        <RunEntry
          key={`${entry.kind}-${entry.kind === "action" ? entry.action.id : entry.step.stepKey}`}
          data-kind={entry.kind}
          indent={entry.kind === "action"}
        >
          <time dateTime={entry.at}>{formatUtc(entry.at)}</time>
          {entry.kind === "action" ? (
            <ActionEntry
              action={entry.action}
              mainAgent={mainAgent ?? "The main agent"}
              activityPath={activityPath}
            />
          ) : (
            <StepEntry kind={entry.kind} step={entry.step} />
          )}
        </RunEntry>
      ))}
    </RunList>
  );
}
