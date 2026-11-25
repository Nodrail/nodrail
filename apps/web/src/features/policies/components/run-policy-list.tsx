"use client";

import type { ReactNode } from "react";
import {
  DataActionsCell,
  DataActionsHeading,
  DataPanel,
  DataTable,
  DataTitle,
  DataTitleLink,
  DataToolbar,
  NoMatches,
} from "@/components/app/data-table";
import { SearchField } from "@/components/app/list-filters";
import { useListSearch } from "@/components/app/use-list-search";
import { operationLabel, resourceLabel } from "@/contracts/v1/policies";
import { IMPACT_DAYS, type BudgetUsageDto } from "@/contracts/v1/policy-impact";
import {
  metricLabels,
  requirementLabel,
  type BudgetDto,
  type GateDto,
} from "@/contracts/v1/runs";
import { plural } from "@/lib/text";
import { HoldBadge } from "./rule-parts";
import { RunPolicyActions } from "./run-policy-actions";

export type ListWhere = {
  workspace: string;
  environment: string;
  revision: number;
  listPath: string;
  canManage: boolean;
};

/** One row: the name (to its form) with a quiet line, its cells, actions. */
function EntryRow<T extends { id: string; name: string }>({
  kind,
  item,
  where,
  describe,
  children,
}: {
  kind: "gate" | "budget";
  item: T;
  where: ListWhere;
  describe: (item: T) => ReactNode;
  children: ReactNode;
}) {
  const { canManage, ...target } = where;
  return (
    <tr>
      <td>
        {canManage ? (
          <DataTitleLink href={`${where.listPath}/${item.id}/edit`}>
            {item.name}
          </DataTitleLink>
        ) : (
          <DataTitle>{item.name}</DataTitle>
        )}
        <small>{describe(item)}</small>
      </td>
      {children}
      <DataActionsCell>
        {canManage ? (
          <RunPolicyActions
            {...target}
            kind={kind}
            id={item.id}
            name={item.name}
          />
        ) : null}
      </DataActionsCell>
    </tr>
  );
}

/** The Rules tab's table, for gates or budgets: search, rows, actions. */
function EntryTable<T extends { id: string; name: string }>({
  kind,
  items,
  where,
  search,
  headings,
  cells,
  describe,
}: {
  kind: "gate" | "budget";
  items: T[];
  where: ListWhere;
  search: (item: T) => (string | null)[];
  /** Column headings after the first, which is the name. */
  headings: string[];
  cells: (item: T) => ReactNode;
  /** The quiet line under the name. */
  describe: (item: T) => ReactNode;
}) {
  const { query, setQuery, visible } = useListSearch(items, search);
  const noun = kind === "gate" ? "gates" : "budgets";
  return (
    <DataPanel data-tour={`policies-${noun}`}>
      <DataToolbar>
        <SearchField
          label={`Search ${noun}`}
          placeholder={
            kind === "gate"
              ? "Search gate, action or step agent"
              : "Search budget or agent"
          }
          value={query}
          onChange={setQuery}
        />
      </DataToolbar>
      {visible.length === 0 ? (
        <NoMatches noun={noun}>Try a different search.</NoMatches>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th scope="col">{kind === "gate" ? "Gate" : "Budget"}</th>
              {headings.map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
              <DataActionsHeading />
            </tr>
          </thead>
          <tbody className="stagger">
            {visible.map((item) => (
              <EntryRow
                key={item.id}
                kind={kind}
                item={item}
                where={where}
                describe={describe}
              >
                {cells(item)}
              </EntryRow>
            ))}
          </tbody>
        </DataTable>
      )}
    </DataPanel>
  );
}

const gateText = (gate: GateDto) => [
  gate.name,
  gate.agentKey,
  operationLabel(gate),
  resourceLabel(gate.resource),
  ...gate.requires.map(requirementLabel),
];

/** The live gates, each checked against a run's history. */
export function GateList({
  gates,
  where,
}: {
  gates: GateDto[];
  where: ListWhere;
}) {
  return (
    <EntryTable
      kind="gate"
      items={gates}
      where={where}
      search={gateText}
      headings={["Agent", "Required steps", "While steps are missing"]}
      describe={(gate) =>
        `${operationLabel(gate)} · ${resourceLabel(gate.resource)}`
      }
      cells={(gate) => (
        <>
          <td>{gate.agentKey ?? "All agents"}</td>
          <td>
            {gate.requires.map((requirement) => (
              <span key={requirement.agent} className="block">
                {requirementLabel(requirement)}
              </span>
            ))}
          </td>
          <td>
            <HoldBadge effect={gate.effect} />
          </td>
        </>
      )}
    />
  );
}

const budgetScope = (budget: BudgetDto) =>
  budget.per === "step" ? `Each ${budget.agent ?? "agent's"} step` : "Each run";

const budgetText = (budget: BudgetDto) => [
  budget.name,
  budget.agent,
  metricLabels[budget.metric],
  budgetScope(budget),
];

const amount = (budget: BudgetDto, value: number) =>
  budget.metric === "usd" ? `USD ${value}` : value.toLocaleString("en");

/** How high a budget got lately, and how many runs it held. */
function UsageCell({
  budget,
  usage,
}: {
  budget: BudgetDto;
  usage: BudgetUsageDto | undefined;
}) {
  if (!usage?.runs)
    return (
      <td>
        <span className="text-muted-foreground">No runs</span>
        <small>Last {IMPACT_DAYS} days</small>
      </td>
    );
  return (
    <td>
      Peak {amount(budget, usage.peak ?? 0)} of {amount(budget, budget.limit)}
      <small>
        {usage.held
          ? `${plural(usage.held, "run")} stopped`
          : "No runs stopped"}{" "}
        of {usage.runs} in {IMPACT_DAYS} days
      </small>
    </td>
  );
}

/** The live budgets, each counted over a step or a run, with recent usage. */
export function BudgetList({
  budgets,
  usage,
  where,
}: {
  budgets: BudgetDto[];
  /** Each budget's recent usage, by id. */
  usage: Record<string, BudgetUsageDto>;
  where: ListWhere;
}) {
  return (
    <EntryTable
      kind="budget"
      items={budgets}
      where={where}
      search={budgetText}
      headings={["Counts", "Limit", "Recent use", "When exceeded"]}
      describe={budgetScope}
      cells={(budget) => (
        <>
          <td>{metricLabels[budget.metric]}</td>
          <td>
            {amount(budget, budget.limit)}
            <small>
              {budget.warnAt === null
                ? "No warning"
                : `Warns at ${amount(budget, budget.warnAt)}`}
            </small>
          </td>
          <UsageCell budget={budget} usage={usage[budget.id]} />
          <td>
            <HoldBadge effect={budget.effect} />
          </td>
        </>
      )}
    />
  );
}
