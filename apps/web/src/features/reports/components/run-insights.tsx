import { docsUrl } from "@/features/guidance/docs-url";
import Link from "next/link";
import { TextLink } from "@/components/app/text-link";
import { CardLinks, EmptyState } from "@/components/app/card";
import { Button } from "@/components/ui/button";
import type { ReportDto, ReportWindow } from "@/contracts/v1/reports";
import { medianLabel, shareLabel, spendLabel } from "../presentation";
import { Figures, InsightSection, SubHeading } from "./insight-parts";
import {
  AgentTable,
  BudgetTable,
  CheckTable,
  GateTable,
  TopRunsTable,
} from "./report-tables";

/** How runs start, for a section with none in its window. */
const runsDocs = (
  <Button asChild variant="outline">
    <a href={docsUrl("runs")}>How runs work</a>
  </Button>
);

/** No runs in the window: what makes them appear, and the first step. */
function NoRuns({ days, base }: { days: ReportWindow; base: string }) {
  return (
    <EmptyState
      inline
      title={`No runs in the last ${days} days`}
      action={
        <Button asChild variant="outline">
          <Link href={`${base}/policies/budgets`}>Open budgets</Link>
        </Button>
      }
    >
      A first tool decision can create a run. Add a budget in Policies to cap
      what a run spends. Step reporting depends on the host and integration.
    </EmptyState>
  );
}

/** Where gates hold work, what is missing then, and which budgets ran over. */
export function GatesInsight({
  report,
  days,
  base,
  canImport,
}: {
  report: ReportDto;
  days: ReportWindow;
  base: string;
  canImport: boolean;
}) {
  return (
    <InsightSection
      question="Where do gates and budgets stop work?"
      description="Runs active in this window, compared with the gates and budgets live now. Gate figures use server decisions."
      action={
        <CardLinks>
          <TextLink href={`${base}/policies/gates`}>Open gates</TextLink>
        </CardLinks>
      }
    >
      {report.runs.count === 0 ? (
        <NoRuns days={days} base={base} />
      ) : (
        <>
          <Figures
            figures={[
              {
                label: "Runs with no recorded gate denial",
                value: shareLabel(report.runs.withoutHold),
                hint: "Server-decided calls covered by current gates",
              },
              {
                label: "Budget overruns",
                value: String(
                  report.budgets.reduce((sum, budget) => sum + budget.hits, 0),
                ),
              },
            ]}
          />
          <SubHeading>Gates</SubHeading>
          <GateTable
            gates={report.gates}
            editPath={canImport ? `${base}/policies/gates` : null}
          />
          <SubHeading>Budgets</SubHeading>
          <BudgetTable budgets={report.budgets} base={base} />
        </>
      )}
    </InsightSection>
  );
}

/** How agent teams work: checks passing, work coming back, and what it costs. */
export function TeamsInsight({
  report,
  days,
  base,
}: {
  report: ReportDto;
  days: ReportWindow;
  base: string;
}) {
  const { runs } = report;
  return (
    <InsightSection
      question="How do agent teams work together?"
      description="A verdict is what the agent reported. Rework loop: a builder working again after a check rejected the work. Spend is what receipts reported."
      action={
        <CardLinks>
          <TextLink href={`${base}/activity?view=runs`}>Open runs</TextLink>
        </CardLinks>
      }
    >
      {runs.count === 0 ? (
        <EmptyState
          inline
          title={`No runs in the last ${days} days`}
          action={runsDocs}
        >
          This section shows how checks like qa or reviewer pass work, how often
          it comes back, and what each run costs. It fills in once agents report
          their steps under a run key.
        </EmptyState>
      ) : (
        <>
          <Figures
            figures={[
              { label: "Runs", value: String(runs.count) },
              runs.medianSteps === null
                ? {
                    label: "Median steps per run",
                    value: null,
                    hint: "No steps reported",
                  }
                : {
                    label: "Median steps per run",
                    value: medianLabel(runs.medianSteps),
                  },
              {
                label: "Rework loops",
                value: String(runs.reworkLoops),
                hint: `in ${runs.withRework} of ${runs.count} runs`,
              },
              runs.spend.usd > 0 || runs.spend.tokens > 0
                ? { label: "Spend", value: spendLabel(runs.spend) }
                : { label: "Spend", value: null, hint: "No spend reported" },
            ]}
          />
          <SubHeading>Checks</SubHeading>
          <CheckTable checks={report.checks} />
          <SubHeading>Agents</SubHeading>
          <AgentTable agents={report.agents} />
          <SubHeading>Runs that spent most</SubHeading>
          <TopRunsTable runs={report.topRuns} base={base} />
        </>
      )}
    </InsightSection>
  );
}
