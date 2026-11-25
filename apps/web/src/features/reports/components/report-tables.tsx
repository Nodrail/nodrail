import Link from "next/link";
import { DataTitle, DataTitleLink } from "@/components/app/data-table";
import type {
  AgentReportDto,
  BudgetReportDto,
  CheckReportDto,
  GateReportDto,
  RunSpendDto,
} from "@/contracts/v1/reports";
import { runPath } from "@/features/runs/presentation";
import { shareLabel, spendLabel } from "../presentation";
import { InsightTable, Meter } from "./insight-parts";

/** Gates with how they held; each opens its form for people who manage policies. */
export function GateTable({
  gates,
  editPath = null,
}: {
  gates: GateReportDto[];
  /** The Gates tab, when this person may edit gates. */
  editPath?: string | null;
}) {
  return (
    <InsightTable
      label="Gates"
      empty={
        gates.length
          ? null
          : "No gates in the policies live now. Add one on the Gates tab of Policies."
      }
      headings={["Gate", "Checked", "Stopped", "First pass", "Usually missing"]}
    >
      {gates.map((gate) => (
        <tr key={gate.id}>
          <td>
            {editPath ? (
              <DataTitleLink href={`${editPath}/${gate.id}/edit`}>
                {gate.name}
              </DataTitleLink>
            ) : (
              <DataTitle>{gate.name}</DataTitle>
            )}
          </td>
          <td>{gate.checked}</td>
          <td>{gate.held}</td>
          <td>{shareLabel(gate.firstPass)}</td>
          <td>
            {gate.missing.length ? (
              gate.missing.slice(0, 2).map(({ label, count }) => (
                <span key={label} className="block">
                  {label} <small className="inline">×{count}</small>
                </span>
              ))
            ) : (
              <span className="text-muted-foreground">Nothing</span>
            )}
          </td>
        </tr>
      ))}
    </InsightTable>
  );
}

export function BudgetTable({
  budgets,
  base,
}: {
  budgets: BudgetReportDto[];
  base: string;
}) {
  return (
    <InsightTable
      label="Budgets"
      empty={
        budgets.length
          ? null
          : "No budgets in the rules live now. Add one to a rules file to limit tool calls, tokens or cost."
      }
      headings={["Budget", "Overruns", "Runs"]}
    >
      {budgets.map((budget) => (
        <tr key={budget.id}>
          <td>
            <DataTitle>{budget.name}</DataTitle>
          </td>
          <td>{budget.hits}</td>
          <td>
            {budget.runs.length
              ? budget.runs.map((run, index) => (
                  <span key={run.id}>
                    {index ? ", " : null}
                    <Link
                      href={runPath(base, run.id)}
                      className="font-mono text-xs hover:underline"
                    >
                      {run.key}
                    </Link>
                  </span>
                ))
              : "None"}
          </td>
        </tr>
      ))}
    </InsightTable>
  );
}

const verdictsLabel = (agent: AgentReportDto) =>
  agent.verdicts.length
    ? agent.verdicts
        .map(({ verdict, count }) => `${verdict} ${count}`)
        .join(", ")
    : "None";

export function AgentTable({ agents }: { agents: AgentReportDto[] }) {
  const max = Math.max(0, ...agents.map((agent) => agent.spend.usd));
  return (
    <InsightTable
      label="Agents"
      empty={
        agents.length
          ? null
          : "No steps reported in this window. Steps appear when an integration reports its subagents starting and finishing."
      }
      headings={[
        "Agent",
        "Steps",
        "Verdicts",
        "Sent back",
        "Contradicted passes",
        "Spend",
      ]}
    >
      {agents.map((agent) => (
        <tr key={agent.agent}>
          <td>
            <DataTitle>{agent.agent}</DataTitle>
            {agent.withoutReceipt ? (
              <small>{agent.withoutReceipt} without a receipt</small>
            ) : null}
          </td>
          <td>{agent.steps}</td>
          <td>{verdictsLabel(agent)}</td>
          <td>{agent.backSteps}</td>
          <td>{agent.contradictedPasses}</td>
          <td className="min-w-32">
            {spendLabel(agent.spend)}
            {agent.spend.usd > 0 ? (
              <Meter value={agent.spend.usd} max={max} />
            ) : null}
          </td>
        </tr>
      ))}
    </InsightTable>
  );
}

export function CheckTable({ checks }: { checks: CheckReportDto[] }) {
  return (
    <InsightTable
      label="Checks"
      empty={
        checks.length
          ? null
          : "No check reported a verdict. Checks are the agents a gate requires, such as qa or reviewer."
      }
      headings={["Check", "Runs", "Passed first try", "Passed eventually"]}
    >
      {checks.map((check) => (
        <tr key={check.agent}>
          <td>
            <DataTitle>{check.agent}</DataTitle>
          </td>
          <td>{check.runs}</td>
          <td>{shareLabel({ count: check.firstTry, of: check.runs })}</td>
          <td>{shareLabel({ count: check.eventually, of: check.runs })}</td>
        </tr>
      ))}
    </InsightTable>
  );
}

export function TopRunsTable({
  runs,
  base,
}: {
  runs: RunSpendDto[];
  base: string;
}) {
  const max = Math.max(0, ...runs.map((run) => run.spend.usd));
  return (
    <InsightTable
      label="Runs that spent most"
      empty={
        runs.length
          ? null
          : "No step reported spending. Steps report it in their receipt as usd and tokens."
      }
      headings={["Run", "Steps", "Rework loops", "Spend"]}
    >
      {runs.map((run) => (
        <tr key={run.id}>
          <td className="w-full">
            <DataTitleLink href={runPath(base, run.id)} className="font-mono">
              {run.key}
            </DataTitleLink>
          </td>
          <td>{run.steps}</td>
          <td>{run.reworkLoops}</td>
          <td className="min-w-32 whitespace-nowrap">
            {spendLabel(run.spend)}
            <Meter value={run.spend.usd} max={max} />
          </td>
        </tr>
      ))}
    </InsightTable>
  );
}
