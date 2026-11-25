import { TextLink } from "@/components/app/text-link";
import { CardLinks } from "@/components/app/card";
import { DataTitleLink } from "@/components/app/data-table";
import {
  COVERAGE_WINDOW_DAYS,
  STALLED_STEP_MINUTES,
  type HealthDto,
} from "@/contracts/v1/health";
import { runPath } from "@/features/runs/presentation";
import { timeAgo } from "@/lib/time";
import {
  Figures,
  InsightSection,
  InsightTable,
  RowAction,
  SubHeading,
} from "./insight-parts";

/** The agent's name, linked to its page, over its installation. */
function AgentCell({
  base,
  item,
}: {
  base: string;
  item: { agentKey: string; installationName: string };
}) {
  return (
    <td className="w-full">
      <DataTitleLink href={`${base}/agents/${item.agentKey}`}>
        {item.agentKey}
      </DataTitleLink>
      <small>{item.installationName}</small>
    </td>
  );
}

/** "3 min ago", from a moment the server read. */
function Ago({ at }: { at: string | null }) {
  return (
    <td className="whitespace-nowrap text-muted-foreground">
      <span suppressHydrationWarning>{at ? timeAgo(at) : "Never"}</span>
    </td>
  );
}

const key = (item: { agentKey: string; installationName: string }) =>
  `${item.agentKey}-${item.installationName}`;

function HealthFigures({ health }: { health: HealthDto }) {
  return (
    <Figures
      figures={[
        {
          label: "Silent agents",
          value: String(health.silent.length),
          hint: `${health.agents.reporting} of ${health.agents.connected} reporting`,
        },
        { label: "Stalled steps", value: String(health.stalledSteps.length) },
        {
          label: "Not covered by rules",
          value: String(health.uncovered.length),
        },
      ]}
    />
  );
}

/** Agents gone quiet, steps stuck, and installations no rule covers: now. */
export function HealthInsight({
  health,
  base,
}: {
  health: HealthDto;
  base: string;
}) {
  const { silent, stalledSteps, uncovered } = health;
  return (
    <InsightSection
      question="Is anything stuck or uncovered right now?"
      description={`As of now, whatever the window. A step is stalled after ${STALLED_STEP_MINUTES} minutes with no activity in its run; an installation is uncovered when most of its actions in the last ${COVERAGE_WINDOW_DAYS} days matched no rule.`}
      action={
        <CardLinks>
          <TextLink href={`${base}/agents`}>Open Agents</TextLink>
        </CardLinks>
      }
    >
      <HealthFigures health={health} />
      <SubHeading>Silent agents</SubHeading>
      <InsightTable
        label="Silent agents"
        headings={["Agent", "Last seen"]}
        empty={silent.length ? null : <b>Every agent is reporting</b>}
      >
        {silent.map((item) => (
          <tr key={key(item)}>
            <AgentCell base={base} item={item} />
            <Ago at={item.lastSeenAt} />
          </tr>
        ))}
      </InsightTable>
      <SubHeading>Stalled steps</SubHeading>
      <InsightTable
        label="Stalled steps"
        headings={["Run", "Step", "Last activity"]}
        empty={stalledSteps.length ? null : <b>No stalled steps</b>}
      >
        {stalledSteps.map((step) => (
          <tr key={`${step.runId}-${step.stepKey}`}>
            <td className="w-full">
              <DataTitleLink
                href={runPath(base, step.runId)}
                className="font-mono"
              >
                {step.runKey}
              </DataTitleLink>
            </td>
            <td>{step.stepAgent}</td>
            <Ago at={step.lastActivityAt} />
          </tr>
        ))}
      </InsightTable>
      <SubHeading>Installations no rule covers</SubHeading>
      <InsightTable
        label="Installations no rule covers"
        headings={["Agent", "Matched no rule"]}
        actions
        empty={uncovered.length ? null : <b>Rules cover what agents ask</b>}
      >
        {uncovered.map((item) => (
          <tr key={key(item)}>
            <AgentCell base={base} item={item} />
            <td className="whitespace-nowrap">
              {item.uncovered} of {item.actions} actions
            </td>
            <RowAction
              href={`${base}/activity?agent=${item.agentKey}&outcome=denied`}
            >
              See denied actions
            </RowAction>
          </tr>
        ))}
      </InsightTable>
    </InsightSection>
  );
}
