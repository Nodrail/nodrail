"use client";

import { useState } from "react";
import { formGridWide } from "@/components/app/form-feedback";
import { FormField, SelectField } from "@/components/app/form-field";
import { operationPattern, type ResourceScope } from "@/contracts/v1/policies";
import type { PolicySuggestionsDto } from "@/contracts/v1/policy-impact";
import { Suggestions } from "./suggestions";

function OperationField({
  operation,
  onOperationChange,
  operations,
}: {
  operation: string;
  onOperationChange: (operation: string) => void;
  operations: string[];
}) {
  return (
    <div className={formGridWide}>
      <FormField
        id="operation"
        name="operation"
        label="Operation"
        placeholder="github.issues.list"
        hint="The tool, then the operation, separated by a dot."
        value={operation}
        onChange={(event) => onOperationChange(event.target.value)}
        pattern={operationPattern}
        list="operation-suggestions"
        autoComplete="off"
        required
      />
      <Suggestions id="operation-suggestions" values={operations} />
    </div>
  );
}

/**
 * The operation and resource a rule or gate matches, as cells of a two-column
 * form grid, offering what this environment has seen. The operation is the
 * parent's, so it can react to it.
 */
export function TargetFields({
  operation,
  onOperationChange,
  resource,
  suggestions,
}: {
  operation: string;
  onOperationChange: (operation: string) => void;
  resource?: ResourceScope;
  suggestions: PolicySuggestionsDto;
}) {
  const [match, setMatch] = useState(resource?.match ?? "exact");
  const [kind, setKind] = useState(resource?.kind ?? "");
  const values =
    suggestions.resources.find((item) => item.kind === kind.trim())?.values ??
    [];
  return (
    <>
      <OperationField
        operation={operation}
        onOperationChange={onOperationChange}
        operations={suggestions.operations}
      />
      <FormField
        id="resourceKind"
        name="resourceKind"
        label="Resource type"
        placeholder="repository"
        value={kind}
        onChange={(event) => setKind(event.target.value)}
        maxLength={64}
        list="resource-kind-suggestions"
        autoComplete="off"
        required
      />
      <Suggestions
        id="resource-kind-suggestions"
        values={suggestions.resources.map((item) => item.kind)}
      />
      <SelectField
        id="resourceMatch"
        name="resourceMatch"
        label="Which resources"
        value={match}
        onChange={(event) => setMatch(event.target.value as typeof match)}
        hint={
          match === "prefix"
            ? "Plain text matching: acme/support also matches acme/support-extra. End with / to stop at a folder or site. Never a sandbox for shell commands."
            : undefined
        }
      >
        <option value="exact">Exactly this one</option>
        <option value="prefix">Starting with</option>
        <option value="any">Any</option>
      </SelectField>
      {match === "any" ? null : (
        <div className={formGridWide}>
          <FormField
            id="resourceValue"
            name="resourceValue"
            label="Resource"
            placeholder="acme/support"
            defaultValue={resource?.value}
            maxLength={512}
            list="resource-value-suggestions"
            autoComplete="off"
            required
          />
          <Suggestions id="resource-value-suggestions" values={values} />
        </div>
      )}
    </>
  );
}
