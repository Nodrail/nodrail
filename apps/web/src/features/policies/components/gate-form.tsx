"use client";

import { formGrid, formGridWide } from "@/components/app/form-feedback";
import { useState } from "react";
import { Card } from "@/components/app/card";
import { ActionForm } from "@/components/app/action-form";
import { FormField, SelectField } from "@/components/app/form-field";
import { Note } from "@/components/app/note";
import { Button } from "@/components/ui/button";
import type { AgentOptionDto } from "@/contracts/v1/agents";
import { operationLabel } from "@/contracts/v1/policies";
import type { PolicySuggestionsDto } from "@/contracts/v1/policy-impact";
import type { GateDto } from "@/contracts/v1/runs";
import { gateFromForm, splitList } from "../form";
import { useRows } from "../use-rows";
import {
  SaveFooter,
  publishLabel,
  useSave,
  type Where,
} from "./run-policy-save";
import { Suggestions, stepAgentHint } from "./suggestions";
import { TargetFields } from "./target-fields";

const requirementRow =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-start gap-2 phone:grid-cols-1 [&>button]:mt-7 phone:[&>button]:mt-0";

type RequirementDraft = {
  key: number;
  agent: string;
  verdicts: string;
  since: string;
};

/** The steps a gate waits for, as rows you can add and remove. */
function useRequirements(initial: GateDto["requires"] | undefined) {
  const blank = { agent: "", verdicts: "pass", since: "" };
  const requirements = useRows<Omit<RequirementDraft, "key">>(
    initial?.length
      ? initial.map((item) => ({
          agent: item.agent,
          verdicts: item.verdicts.join(", "),
          since: item.since.join(", "),
        }))
      : [blank],
    blank,
  );
  const serialized = JSON.stringify(
    requirements.rows
      .filter((row) => row.agent.trim())
      .map((row) => ({
        agent: row.agent.trim(),
        verdicts: splitList(row.verdicts),
        since: splitList(row.since),
      })),
  );
  return { ...requirements, serialized };
}

/** The gate's name, what it does while steps are missing, and its agent. */
function GateCard({
  gate,
  agents,
}: {
  gate?: GateDto;
  agents: AgentOptionDto[];
}) {
  // An agent no longer in the list stays selectable, so saving keeps it.
  const agentKeys = agents.map((item) => item.key);
  if (gate?.agentKey && !agentKeys.includes(gate.agentKey))
    agentKeys.push(gate.agentKey);
  return (
    <Card title="Gate" tour="run-policy-entry">
      <div className={formGrid}>
        <div className={formGridWide}>
          <FormField
            id="name"
            name="name"
            label="Gate name"
            placeholder="QA before a pull request"
            defaultValue={gate?.name}
            maxLength={120}
            required
          />
        </div>
        <SelectField
          id="agentKey"
          name="agentKey"
          label="Agent"
          defaultValue={gate?.agentKey ?? ""}
        >
          <option value="">All agents</option>
          {agentKeys.map((key) => (
            <option key={key}>{key}</option>
          ))}
        </SelectField>
      </div>
    </Card>
  );
}

type Requirements = ReturnType<typeof useRequirements>;

/** One requirement's fields and its remove button. */
function RequirementFields({
  row,
  index,
  only,
  requirements,
  stepAgents,
}: {
  row: RequirementDraft;
  index: number;
  only: boolean;
  requirements: Requirements;
  stepAgents: string[];
}) {
  const field = (name: keyof Omit<RequirementDraft, "key">) => ({
    id: `requirement-${name}-${row.key}`,
    value: row[name],
    autoComplete: "off",
    onChange: (event: { target: { value: string } }) =>
      requirements.update(row.key, { [name]: event.target.value }),
  });
  return (
    <fieldset className={requirementRow}>
      <legend className="sr-only">Requirement {index + 1}</legend>
      <FormField
        {...field("agent")}
        label="Step agent"
        placeholder="qa"
        list="step-agent-suggestions"
        hint={stepAgentHint(row.agent, stepAgents)}
        required
      />
      <FormField
        {...field("verdicts")}
        label="Verdicts"
        placeholder="pass"
        list="verdict-suggestions"
        hint="Separate several with commas."
        required
      />
      <FormField
        {...field("since")}
        label="After work by"
        placeholder="dev, infra"
        list="step-agent-suggestions"
        hint={stepAgentHint(row.since, stepAgents)}
        optional
      />
      <Button
        type="button"
        variant="ghost"
        aria-label={`Remove requirement ${index + 1}`}
        disabled={only}
        onClick={() => requirements.remove(row.key)}
      >
        Remove
      </Button>
    </fieldset>
  );
}

function RequirementsCard({
  requirements,
  suggestions,
}: {
  requirements: Requirements;
  suggestions: PolicySuggestionsDto;
}) {
  return (
    <Card
      title="Required steps"
      tour="run-policy-requires"
      description="The gate holds the action while a step is missing: each step agent must report one of the verdicts, after the last change to the code and after any work by the agents you list."
    >
      <div className="grid gap-3">
        {requirements.rows.map((row, index) => (
          <RequirementFields
            key={row.key}
            row={row}
            index={index}
            only={requirements.rows.length === 1}
            requirements={requirements}
            stepAgents={suggestions.stepAgents}
          />
        ))}
        <Suggestions
          id="step-agent-suggestions"
          values={suggestions.stepAgents}
        />
        <Suggestions id="verdict-suggestions" values={suggestions.verdicts} />
        <div>
          <Button type="button" variant="outline" onClick={requirements.add}>
            Add requirement
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** A gate: an operation held while named steps of the run are missing. */
export function GateForm({
  where,
  agents,
  suggestions,
  gate,
}: {
  where: Where;
  agents: AgentOptionDto[];
  suggestions: PolicySuggestionsDto;
  gate?: GateDto;
}) {
  const save = useSave(
    where,
    { kind: "gate", id: gate?.id ?? null },
    gateFromForm,
  );
  const [operation, setOperation] = useState(gate ? operationLabel(gate) : "");
  const requirements = useRequirements(gate?.requires);
  return (
    <ActionForm
      action={save.submit}
      {...save.form}
      className="grid max-w-190 gap-3"
    >
      <input type="hidden" name="requires" value={requirements.serialized} />
      <GateCard gate={gate} agents={agents} />
      <Card title="Holds this action">
        <div className={formGrid}>
          <TargetFields
            operation={operation}
            onOperationChange={setOperation}
            resource={gate?.resource}
            suggestions={suggestions}
          />
        </div>
      </Card>
      <RequirementsCard requirements={requirements} suggestions={suggestions} />
      <Note>
        <b>A gate only denies.</b> While a step is missing, the action is denied
        with what is missing. Once all pass, your rules decide as usual.
      </Note>
      {save.preview}
      <SaveFooter
        state={save.state}
        pending={save.pending}
        label={publishLabel(Boolean(gate), where.environmentName)}
        environmentName={where.environmentName}
      />
    </ActionForm>
  );
}
