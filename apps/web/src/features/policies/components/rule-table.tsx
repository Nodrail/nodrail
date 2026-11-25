"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  FilterSelect,
  SearchField,
  SegmentedFilter,
} from "@/components/app/list-filters";
import { Button } from "@/components/ui/button";
import {
  operationLabel,
  resourceLabel,
  ruleStatusLabels,
  type Effect,
  type RuleDto,
} from "@/contracts/v1/policies";
import { RowActions } from "@/components/app/row-actions";
import { useListSearch } from "@/components/app/use-list-search";
import { StatusBadge } from "@/components/app/status-badge";
import { LAST_MATCHED_DAYS } from "@/contracts/v1/policy-impact";
import { timeAgo } from "@/lib/time";
import { EffectBadge, revokeRuleConfirm } from "./rule-parts";
import {
  DataActionsCell,
  DataActionsHeading,
  DataPanel,
  DataTable,
  DataTitleLink,
  DataToolbar,
  NoMatches,
} from "@/components/app/data-table";
import { appPath } from "@/lib/product-path";

type EffectFilter = "all" | Effect;

const effectOptions: { value: EffectFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Deny" },
];

/** What a rule is found by in the search box. */
const ruleText = (rule: RuleDto) => [
  rule.name,
  rule.agentKey,
  rule.installationName,
  operationLabel(rule),
  resourceLabel(rule.resource),
];

/**
 * A rule's "⋯" menu: its page, editing it, a new rule for the same agent and
 * revoking it (after a confirmation). Revoked rules are history: view only.
 */
function RuleActions({
  workspace,
  environment,
  rule,
  canManage,
}: {
  workspace: string;
  environment: string;
  rule: RuleDto;
  canManage: boolean;
}) {
  const base = appPath(workspace, environment, "policies");
  const live = canManage && rule.status !== "revoked";
  return (
    <RowActions
      name={rule.name}
      items={[
        { label: "View", href: `${base}/${rule.logicalRuleId}` },
        live
          ? { label: "Edit", href: `${base}/${rule.logicalRuleId}/edit` }
          : null,
        canManage && rule.agentKey
          ? {
              label: `New rule for ${rule.agentKey}`,
              href: `${base}/new?agent=${encodeURIComponent(rule.agentKey)}`,
            }
          : null,
        "separator",
        live
          ? {
              label: "Revoke…",
              destructive: true,
              confirm: revokeRuleConfirm(workspace, environment, rule),
            }
          : null,
      ]}
    />
  );
}

/** Who a scoped rule applies to; nothing for every agent. */
const scopeOf = (rule: RuleDto) =>
  rule.agentKey
    ? ` · ${rule.agentKey}${rule.installationName ? ` / ${rule.installationName}` : ""}`
    : "";

const quiet = "text-muted-foreground";

/** One rule: what it covers, its decision, when it last decided, its end. */
function RuleRow({
  workspace,
  environment,
  rule,
  lastMatched,
  canManage,
}: {
  workspace: string;
  environment: string;
  rule: RuleDto;
  lastMatched: string | undefined;
  canManage: boolean;
}) {
  const base = appPath(workspace, environment, "policies");
  return (
    <tr>
      <td>
        <DataTitleLink href={`${base}/${rule.logicalRuleId}`}>
          {rule.name}
        </DataTitleLink>{" "}
        {rule.status === "active" ? null : (
          <StatusBadge tone="neutral">
            {ruleStatusLabels[rule.status]}
          </StatusBadge>
        )}
        <small>
          {operationLabel(rule)} · {resourceLabel(rule.resource)}
          {scopeOf(rule)}
        </small>
      </td>
      <td>
        <EffectBadge effect={rule.effect} />
      </td>
      <td>
        {lastMatched ? (
          <time dateTime={lastMatched} suppressHydrationWarning>
            {timeAgo(lastMatched)}
          </time>
        ) : (
          <span className={quiet}>Not in {LAST_MATCHED_DAYS} days</span>
        )}
      </td>
      <td>
        {rule.expiresAt ? (
          <time dateTime={rule.expiresAt}>{rule.expiresAt.slice(0, 10)}</time>
        ) : (
          <span className={quiet}>Never</span>
        )}
      </td>
      <DataActionsCell>
        {canManage && rule.status !== "revoked" ? (
          <Button asChild variant="outline" size="sm">
            <Link
              href={`${base}/${rule.logicalRuleId}/edit`}
              aria-label={`Edit ${rule.name}`}
            >
              Edit
            </Link>
          </Button>
        ) : null}
        <RuleActions
          workspace={workspace}
          environment={environment}
          rule={rule}
          canManage={canManage}
        />
      </DataActionsCell>
    </tr>
  );
}

export function RuleTable({
  workspace,
  environment,
  rules,
  lastMatched,
  agents,
  initialAgent,
  canManage,
}: {
  workspace: string;
  environment: string;
  rules: RuleDto[];
  /** When each rule last decided an action, by logical rule id. */
  lastMatched: Record<string, string>;
  /** The agent filter's choices; with none, there is no agent filter. */
  agents: string[];
  initialAgent: string;
  canManage: boolean;
}) {
  const [agent, setAgent] = useState(
    agents.includes(initialAgent) ? initialAgent : "all",
  );
  const [effect, setEffect] = useState<EffectFilter>("all");

  const keep = useCallback(
    (rule: RuleDto) =>
      (effect === "all" ||
        (rule.status === "active" && rule.effect === effect)) &&
      (agent === "all" || !rule.agentKey || rule.agentKey === agent),
    [agent, effect],
  );
  const { query, setQuery, visible } = useListSearch(rules, ruleText, keep);

  return (
    <DataPanel data-tour="policies-rules">
      <DataToolbar>
        <SearchField
          label="Search rules"
          placeholder="Search agent, action, or resource"
          value={query}
          onChange={setQuery}
        />
        {agents.length ? (
          <FilterSelect
            id="rule-agent-filter"
            label="Filter by agent"
            options={[
              { value: "all", label: "All agents" },
              ...agents.map((key) => ({ value: key, label: key })),
            ]}
            value={agent}
            onChange={setAgent}
          />
        ) : null}
        <SegmentedFilter
          label="Filter by decision"
          options={effectOptions}
          value={effect}
          onChange={setEffect}
        />
      </DataToolbar>
      {visible.length === 0 ? (
        <NoMatches noun="rules" />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th scope="col">Rule and scope</th>
              <th scope="col">Decision</th>
              <th scope="col">Last matched</th>
              <th scope="col">Expires</th>
              <DataActionsHeading />
            </tr>
          </thead>
          <tbody className="stagger">
            {visible.map((rule) => (
              <RuleRow
                key={rule.logicalRuleId}
                workspace={workspace}
                environment={environment}
                rule={rule}
                lastMatched={lastMatched[rule.logicalRuleId]}
                canManage={canManage}
              />
            ))}
          </tbody>
        </DataTable>
      )}
    </DataPanel>
  );
}
