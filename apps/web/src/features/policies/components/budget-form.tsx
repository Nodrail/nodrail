"use client";

import { formGrid, formGridWide } from "@/components/app/form-feedback";
import { useState } from "react";
import { ActionForm } from "@/components/app/action-form";
import { Card } from "@/components/app/card";
import { FormField, SelectField } from "@/components/app/form-field";
import type { PolicySuggestionsDto } from "@/contracts/v1/policy-impact";
import { metricLabels, type BudgetDto } from "@/contracts/v1/runs";
import { budgetFromForm } from "../form";
import {
  SaveFooter,
  publishLabel,
  useSave,
  type Where,
} from "./run-policy-save";
import { Suggestions, stepAgentHint } from "./suggestions";

/** The step agent a step budget counts, offering the ones that reported. */
function StepAgentField({
  budget,
  stepAgents,
}: {
  budget?: BudgetDto;
  stepAgents: string[];
}) {
  const [agent, setAgent] = useState(budget?.agent ?? "");
  return (
    <div className={formGridWide}>
      <FormField
        id="agent"
        name="agent"
        label="Step agent"
        placeholder="dev"
        list="step-agent-suggestions"
        autoComplete="off"
        hint={stepAgentHint(
          agent,
          stepAgents,
          "Leave empty to count each step of any agent.",
        )}
        optional
        value={agent}
        onChange={(event) => setAgent(event.target.value)}
      />
      <Suggestions id="step-agent-suggestions" values={stepAgents} />
    </div>
  );
}

/** What a budget counts, per step or per run, and for which step agent. */
function BudgetScope({
  budget,
  stepAgents,
}: {
  budget?: BudgetDto;
  stepAgents: string[];
}) {
  const [per, setPer] = useState(budget?.per ?? "run");
  const [metric, setMetric] = useState(budget?.metric ?? "tool_calls");
  const calls = metric === "tool_calls";
  return (
    <>
      <SelectField
        id="metric"
        name="metric"
        label="Counts"
        value={metric}
        onChange={(event) => {
          const next = event.target.value as typeof metric;
          setMetric(next);
          if (next !== "tool_calls") setPer("run");
        }}
      >
        {(Object.keys(metricLabels) as (keyof typeof metricLabels)[]).map(
          (key) => (
            <option key={key} value={key}>
              {metricLabels[key]}
            </option>
          ),
        )}
      </SelectField>
      <SelectField
        id="per"
        name="per"
        label="Per"
        value={per}
        onChange={(event) => setPer(event.target.value as typeof per)}
        hint={
          calls
            ? undefined
            : "Tokens and spend are known when a step ends, so they are counted per run."
        }
      >
        <option value="run">Run</option>
        <option value="step" disabled={!calls}>
          Step
        </option>
      </SelectField>
      {per === "step" ? (
        <StepAgentField budget={budget} stepAgents={stepAgents} />
      ) : null}
    </>
  );
}

/** A budget: how much a step or a run may do before it is stopped. */
export function BudgetForm({
  where,
  suggestions,
  budget,
}: {
  where: Where;
  suggestions: PolicySuggestionsDto;
  budget?: BudgetDto;
}) {
  const save = useSave(
    where,
    { kind: "budget", id: budget?.id ?? null },
    budgetFromForm,
  );
  return (
    <ActionForm
      action={save.submit}
      {...save.form}
      className="grid max-w-190 gap-3"
    >
      <Card title="Budget" tour="run-policy-entry">
        <div className={formGrid}>
          <div className={formGridWide}>
            <FormField
              id="name"
              name="name"
              label="Budget name"
              placeholder="Spend per run"
              defaultValue={budget?.name}
              maxLength={120}
              required
            />
          </div>
          <BudgetScope budget={budget} stepAgents={suggestions.stepAgents} />
          <FormField
            id="limit"
            name="limit"
            label="Limit"
            inputMode="decimal"
            defaultValue={budget?.limit}
            required
          />
          <FormField
            id="warnAt"
            name="warnAt"
            label="Warn at"
            inputMode="decimal"
            hint="Below the limit. Shown on the run before it is stopped."
            optional
            defaultValue={budget?.warnAt ?? ""}
          />
        </div>
      </Card>
      {save.preview}
      <SaveFooter
        state={save.state}
        pending={save.pending}
        label={publishLabel(Boolean(budget), where.environmentName)}
        environmentName={where.environmentName}
      />
    </ActionForm>
  );
}
