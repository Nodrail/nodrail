import Link from "next/link";
import type { ReactNode } from "react";
import { TextLink } from "@/components/app/text-link";
import { CardLinks, EmptyState } from "@/components/app/card";
import { DataTitleLink } from "@/components/app/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/status-badge";
import type {
  DecisionMetricsDto,
  RuleMetricsDto,
  RuleUsageDto,
} from "@/contracts/v1/insights";
import { effectLabels } from "@/contracts/v1/policies";
import type { ReportWindow } from "@/contracts/v1/reports";
import { plural } from "@/lib/text";
import { timeAgo } from "@/lib/time";
import { percent, shareLabel } from "../presentation";
import {
  Figures,
  InsightSection,
  InsightTable,
  Meter,
  RowAction,
  SplitBar,
  SubHeading,
} from "./insight-parts";

/** How every action in the window was decided. */
function DecisionFigures({ metrics }: { metrics: DecisionMetricsDto }) {
  const byRule = metrics.actions - metrics.noRule;
  return (
    <>
      <Figures
        figures={[
          {
            label: "Decided by a rule",
            value: `${percent({ count: byRule, of: metrics.actions })}%`,
            hint: `${byRule} of ${metrics.actions} actions`,
          },
          { label: "Allowed", value: String(metrics.allowed) },
          { label: "Denied", value: String(metrics.denied) },
          {
            label: "No rule covers them",
            value: String(metrics.noRule),
            hint: "Denied; a rule may be missing",
          },
        ]}
      />
      <SplitBar
        parts={[
          { label: "Allowed", value: metrics.allowed, tone: "success" },
          {
            label: "Denied by a rule",
            value: metrics.denied - metrics.noRule,
            tone: "danger",
          },
          {
            label: "Denied, no rule",
            value: metrics.noRule,
            tone: "warning",
          },
        ]}
      />
    </>
  );
}

/** What the rules allowed and denied, and where a rule may be missing. */
export function DecisionsGlance({
  metrics,
  days,
  base,
}: {
  metrics: DecisionMetricsDto;
  days: ReportWindow;
  base: string;
}) {
  return (
    <InsightSection
      tour="insights-decisions"
      question="What did the rules decide?"
      description={`Actions from the last ${days} days. A rule allows or denies each one; nothing waits for a person.`}
      action={
        <CardLinks>
          <TextLink href={`${base}/activity?outcome=denied`}>
            Open denied actions
          </TextLink>
        </CardLinks>
      }
    >
      {metrics.actions === 0 ? (
        <EmptyState
          inline
          title={`No actions in the last ${days} days`}
          action={
            <Button asChild variant="outline">
              <Link href={`${base}/agents`}>Open Agents</Link>
            </Button>
          }
        >
          This section shows how many actions the rules allowed and denied. It
          fills in once a connected agent asks before acting.
        </EmptyState>
      ) : (
        <DecisionFigures metrics={metrics} />
      )}
    </InsightSection>
  );
}

const rulePath = (base: string, rule: RuleUsageDto) =>
  `${base}/policies/${rule.logicalRuleId}`;

/** The rule's name, linked to its page, over a note. */
function RuleCell({
  base,
  rule,
  children,
}: {
  base: string;
  rule: RuleUsageDto;
  children: ReactNode;
}) {
  return (
    <td className="w-full">
      <DataTitleLink href={rulePath(base, rule)}>{rule.name}</DataTitleLink>
      <small>{children}</small>
    </td>
  );
}

function TopRules({
  rules,
  base,
  days,
}: {
  rules: RuleUsageDto[];
  base: string;
  days: ReportWindow;
}) {
  const max = Math.max(0, ...rules.map((rule) => rule.matches));
  return (
    <InsightTable
      label="Rules that matched most"
      headings={["Rule", "Decided", "Last match"]}
      empty={
        rules.length ? null : <b>No rule matched in the last {days} days</b>
      }
    >
      {rules.map((rule) => (
        <tr key={rule.logicalRuleId}>
          <RuleCell base={base} rule={rule}>
            {effectLabels[rule.effect]}
          </RuleCell>
          <td className="min-w-32 whitespace-nowrap">
            {plural(rule.matches, "action")}
            <Meter value={rule.matches} max={max} />
          </td>
          <td className="whitespace-nowrap text-muted-foreground">
            <span suppressHydrationWarning>
              {rule.lastMatchedAt ? timeAgo(rule.lastMatchedAt) : "—"}
            </span>
          </td>
        </tr>
      ))}
    </InsightTable>
  );
}

/**
 * "2 rules matched; 2 are too new to judge": rules younger than the window
 * had no fair chance to match, so they are counted apart, never as matched.
 */
export function matchedSummary(metrics: RuleMetricsDto) {
  const judged = metrics.activeRules - metrics.newer;
  const matched = judged - metrics.unused.length;
  const all =
    matched === 1
      ? "The rule matched"
      : `All ${plural(matched, "rule")} matched`;
  const verb = metrics.newer === 1 ? "is" : "are";
  if (!metrics.newer) return judged ? `${all}.` : null;
  if (!judged)
    return `${plural(metrics.newer, "rule")} ${verb} too new to judge.`;
  return `${plural(matched, "rule")} matched; ${metrics.newer} ${verb} too new to judge.`;
}

function UnusedRules({
  rules,
  base,
  days,
  summary,
}: {
  rules: RuleUsageDto[];
  base: string;
  days: ReportWindow;
  /** What to say when no rule old enough went unmatched. */
  summary: string | null;
}) {
  return (
    <InsightTable
      label="Rules that never matched"
      headings={["Rule", "Effect"]}
      actions
      empty={rules.length ? null : <b>{summary}</b>}
    >
      {rules.map((rule) => (
        <tr key={rule.logicalRuleId}>
          <RuleCell base={base} rule={rule}>
            No match in {days} days
          </RuleCell>
          <td>
            <StatusBadge tone="neutral">
              {effectLabels[rule.effect]}
            </StatusBadge>
          </td>
          <RowAction href={rulePath(base, rule)}>Review rule</RowAction>
        </tr>
      ))}
    </InsightTable>
  );
}

/** Which rules do the deciding, and which could go. */
export function RulesInsight({
  metrics,
  days,
  base,
}: {
  metrics: RuleMetricsDto;
  days: ReportWindow;
  base: string;
}) {
  return (
    <InsightSection
      tour="insights-rules"
      question="Are the rules doing the work?"
      description="A match is a decision a rule made: allowing or denying."
      action={
        <CardLinks>
          <TextLink href={`${base}/policies`}>Open Policies</TextLink>
        </CardLinks>
      }
    >
      {metrics.activeRules === 0 ? (
        <EmptyState
          inline
          title="No rules yet"
          action={
            <Button asChild variant="outline">
              <Link href={`${base}/policies`}>Add rules</Link>
            </Button>
          }
        >
          Rules allow or deny each action. Start from a starter pack, or write
          one.
        </EmptyState>
      ) : (
        <>
          <Figures
            figures={[
              {
                label: "Actions decided by a rule",
                value: shareLabel(metrics.decided),
              },
              { label: "Active rules", value: String(metrics.activeRules) },
              {
                label: "Never matched",
                value: String(metrics.unused.length),
                hint: metrics.newer
                  ? `${plural(metrics.newer, "rule")} newer than ${days} days not judged`
                  : undefined,
              },
            ]}
          />
          <SubHeading>Matched most</SubHeading>
          <TopRules rules={metrics.top} base={base} days={days} />
          <SubHeading>Never matched: candidates to remove</SubHeading>
          <UnusedRules
            rules={metrics.unused}
            base={base}
            days={days}
            summary={matchedSummary(metrics)}
          />
        </>
      )}
    </InsightSection>
  );
}
