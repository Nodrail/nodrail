"use client";

import { formGrid, formGridWide } from "@/components/app/form-feedback";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { track } from "@/components/analytics/posthog";
import { ActionForm } from "@/components/app/action-form";
import type { ActionResult } from "@/components/app/action-result";
import { Card } from "@/components/app/card";
import { FormField, SelectField } from "@/components/app/form-field";
import { useAppAction } from "@/components/app/use-app-action";
import { Button } from "@/components/ui/button";
import type { AgentOptionDto } from "@/contracts/v1/agents";
import {
  conditionOperators,
  operationLabel,
  type Condition,
  type RuleChangeResultDto,
  type RuleDto,
  type RuleInput,
} from "@/contracts/v1/policies";
import type { PolicySuggestionsDto } from "@/contracts/v1/policy-impact";
import {
  findOverlap,
  formatConditionValue,
  parseConditionValue,
  ruleFromForm,
} from "../form";
import { ruleSummary } from "../summary";
import { useFormEntry, useImpact } from "../use-impact";
import { useRows } from "../use-rows";
import { Note } from "@/components/app/note";
import { DecisionField } from "./decision-field";
import { useRepositoryProject } from "./repository-policy";
import { PublishPreview } from "./publish-preview";
import { SaveFooter, publishLabel } from "./run-policy-save";
import { TargetFields } from "./target-fields";

const conditionRow =
  "grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 phone:grid-cols-1";

const operatorLabels: Record<Condition["op"], string> = {
  eq: "equals",
  neq: "is not",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  in: "is one of",
  contains: "list contains",
};

type ConditionRow = {
  key: number;
  field: string;
  op: Condition["op"];
  value: string;
};

/** A new or changed rule's starting values. */
type Initial = Partial<RuleInput> | undefined;

function useConditions(initial: Initial) {
  const conditions = useRows<Omit<ConditionRow, "key">>(
    (initial?.conditions ?? []).map((item) => ({
      field: item.field,
      op: item.op,
      value: formatConditionValue(item.value),
    })),
    { field: "", op: "eq", value: "" },
  );
  const serialized = JSON.stringify(
    conditions.rows
      .filter((row) => row.field.trim())
      .map((row) => ({
        field: row.field.trim(),
        op: row.op,
        value: parseConditionValue(row.op, row.value),
      })),
  );
  return { ...conditions, serialized };
}

type Conditions = ReturnType<typeof useConditions>;

function ConditionFields({
  row,
  index,
  conditions,
}: {
  row: ConditionRow;
  index: number;
  conditions: Conditions;
}) {
  return (
    <fieldset className={conditionRow}>
      <legend className="sr-only">Condition {index + 1}</legend>
      <FormField
        id={`condition-field-${row.key}`}
        label="Parameter"
        value={row.field}
        onChange={(event) =>
          conditions.update(row.key, { field: event.target.value })
        }
        pattern="[A-Za-z0-9_.]+"
        required
      />
      <SelectField
        id={`condition-op-${row.key}`}
        label="Comparison"
        value={row.op}
        onChange={(event) =>
          conditions.update(row.key, {
            op: event.target.value as Condition["op"],
          })
        }
      >
        {conditionOperators.map((op) => (
          <option key={op} value={op}>
            {operatorLabels[op]}
          </option>
        ))}
      </SelectField>
      <FormField
        id={`condition-value-${row.key}`}
        label="Value"
        value={row.value}
        onChange={(event) =>
          conditions.update(row.key, { value: event.target.value })
        }
        required
      />
      <Button
        type="button"
        variant="ghost"
        aria-label={`Remove condition ${index + 1}`}
        onClick={() => conditions.remove(row.key)}
      >
        Remove
      </Button>
    </fieldset>
  );
}

function ConditionsCard({ conditions }: { conditions: Conditions }) {
  return (
    <Card
      title="Conditions"
      description="Compared with the parameters the agent sends, not the current state of the tool."
    >
      <div className="grid gap-3">
        {conditions.rows.map((row, index) => (
          <ConditionFields
            key={row.key}
            row={row}
            index={index}
            conditions={conditions}
          />
        ))}
        <div>
          <Button type="button" variant="outline" onClick={conditions.add}>
            Add condition
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DecisionCard({ initial }: { initial: Initial }) {
  return (
    <Card title="Rule" tour="rule-decision">
      <div className={formGrid}>
        <div className={formGridWide}>
          <FormField
            id="name"
            name="name"
            label="Rule name"
            defaultValue={initial?.name}
            maxLength={120}
            required
          />
        </div>
        <div className={formGridWide}>
          <DecisionField initial={initial?.effect} />
        </div>
        <FormField
          id="expiresOn"
          name="expiresOn"
          type="date"
          label="Expires"
          hint="Leave empty to keep it until it is revoked."
          optional
          defaultValue={initial?.expiresAt?.slice(0, 10)}
        />
      </div>
    </Card>
  );
}

function ScopeCard({
  initial,
  agents,
  suggestions,
  agentKey,
  onAgentChange,
  operation,
  onOperationChange,
}: {
  initial: Initial;
  agents: AgentOptionDto[];
  suggestions: PolicySuggestionsDto;
  agentKey: string;
  onAgentChange: (key: string) => void;
  operation: string;
  onOperationChange: (operation: string) => void;
}) {
  const installation = agents.find(
    (item) => item.key === agentKey,
  )?.installationName;
  return (
    <Card title="Applies to" tour="rule-scope">
      <div className={formGrid}>
        <SelectField
          id="agentKey"
          name="agentKey"
          label="Agent"
          value={agentKey}
          onChange={(event) => onAgentChange(event.target.value)}
        >
          <option value="">All agents</option>
          {agents.map((item) => (
            <option key={item.key}>{item.key}</option>
          ))}
        </SelectField>
        <SelectField
          id="installationName"
          name="installationName"
          label="Installation"
          defaultValue={initial?.installationName ?? ""}
          key={agentKey}
        >
          <option value="">All installations</option>
          {installation ? <option>{installation}</option> : null}
        </SelectField>
        <TargetFields
          operation={operation}
          onOperationChange={onOperationChange}
          resource={initial?.resource}
          suggestions={suggestions}
        />
      </div>
    </Card>
  );
}

export type RuleWhere = {
  workspace: string;
  environment: string;
  environmentName: string;
};

export function RuleForm({
  action,
  where,
  policiesPath,
  agents,
  rules,
  suggestions,
  rule,
  draft,
  initialAgent = "",
}: {
  action: (
    previous: ActionResult<RuleChangeResultDto>,
    data: FormData,
  ) => Promise<ActionResult<RuleChangeResultDto>>;
  where: RuleWhere;
  policiesPath: string;
  agents: AgentOptionDto[];
  rules: RuleDto[];
  suggestions: PolicySuggestionsDto;
  rule?: RuleDto;
  /** Starting values for a new rule. */
  draft?: Partial<RuleInput>;
  initialAgent?: string;
}) {
  const router = useRouter();
  const initial = rule ?? draft;
  const project = useRepositoryProject();
  const [state, submit, pending] = useAppAction(action, () => {
    track(rule ? "rule_updated" : "rule_created");
    router.push(policiesPath);
  });
  const [agentKey, setAgentKey] = useState(initial?.agentKey ?? initialAgent);
  const [operation, setOperation] = useState(
    initial?.toolKey && initial.operationKey
      ? operationLabel({
          toolKey: initial.toolKey,
          operationKey: initial.operationKey,
        })
      : "",
  );
  const conditions = useConditions(initial);
  const entry = useFormEntry(ruleFromForm, pending);
  const impact = useImpact(
    where,
    { kind: "rule", id: rule?.logicalRuleId ?? null },
    entry,
  );
  const overlap = findOverlap(rules, {
    operation,
    agentKey,
    excludeId: rule?.logicalRuleId,
  });

  return (
    <ActionForm
      action={entry.submitWith(submit)}
      ref={entry.form}
      onChange={entry.read}
      className="grid max-w-190 gap-3"
    >
      <input type="hidden" name="reviewedProjectId" value={project?.id ?? ""} />
      <input type="hidden" name="conditions" value={conditions.serialized} />
      <DecisionCard initial={initial} />
      <ScopeCard
        initial={initial}
        agents={agents}
        suggestions={suggestions}
        agentKey={agentKey}
        onAgentChange={setAgentKey}
        operation={operation}
        onOperationChange={setOperation}
      />
      <ConditionsCard conditions={conditions} />
      <Note>
        <b>Scope matters.</b> Each covered call is checked against current
        rules. If several match, an explicit deny takes precedence over allow.
      </Note>
      {overlap ? (
        <Note tone="warning" role="status">
          Another rule shares this operation and agent: “{overlap.name}”.
          Compare their scopes; this does not confirm that both match the same
          calls.
        </Note>
      ) : null}
      <PublishPreview
        kind="rule"
        state={impact}
        environmentName={where.environmentName}
        summary={entry.value && ruleSummary(entry.value, where.environmentName)}
      />
      <SaveFooter
        state={state}
        pending={pending}
        label={publishLabel(Boolean(rule), where.environmentName)}
        environmentName={where.environmentName}
      />
    </ActionForm>
  );
}
