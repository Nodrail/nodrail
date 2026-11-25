import { cache, Suspense } from "react";
import { DataTableSkeleton } from "@/components/app/skeleton-lists";
import {
  CardSkeleton,
  LineSkeleton,
  skeletonKeys,
} from "@/components/app/skeletons";
import type { ReportWindow } from "@/contracts/v1/reports";
import { readForPage } from "@/features/shell/load-view";
import { getDecisionMetrics, getRuleMetrics } from "@/server/modules/insights";
import { getHealth } from "@/server/modules/health";
import { getReport } from "@/server/modules/reports";
import { DecisionsGlance, RulesInsight } from "./decision-insights";
import { HealthInsight } from "./health-insight";
import { GatesInsight, TeamsInsight } from "./run-insights";
import { appPath } from "@/lib/product-path";

export type SectionProps = {
  workspace: string;
  environment: string;
  days: ReportWindow;
};

const basePath = ({ workspace, environment }: SectionProps) =>
  appPath(workspace, environment);

/** Gates and teams read the same runs: one read per request serves both. */
const loadReport = cache(
  (workspace: string, environment: string, days: ReportWindow) =>
    readForPage(workspace, (context) => getReport(context, environment, days)),
);

/** A section's shape while it loads: heading, figures and a table. */
function SectionSkeleton({
  figures = 0,
  columns = 0,
  rows = 3,
}: {
  figures?: number;
  columns?: number;
  rows?: number;
}) {
  return (
    <div aria-busy="true" data-slot="insight-skeleton">
      <CardSkeleton description>
        {figures ? (
          <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-6 gap-y-3.5">
            {skeletonKeys(figures).map((key) => (
              <div key={key}>
                <LineSkeleton className="mb-0.75 w-24 text-xs" />
                <LineSkeleton className="w-16 text-figure leading-[1.15]" />
              </div>
            ))}
          </div>
        ) : null}
        {columns ? (
          <DataTableSkeleton columns={columns} rows={rows} panel={false} />
        ) : null}
      </CardSkeleton>
    </div>
  );
}

async function Decisions(props: SectionProps) {
  const metrics = await readForPage(props.workspace, (context) =>
    getDecisionMetrics(context, props.environment, props.days),
  );
  return (
    <DecisionsGlance
      metrics={metrics}
      days={props.days}
      base={basePath(props)}
    />
  );
}

async function Rules(props: SectionProps) {
  const metrics = await readForPage(props.workspace, (context) =>
    getRuleMetrics(context, props.environment, props.days),
  );
  return (
    <RulesInsight metrics={metrics} days={props.days} base={basePath(props)} />
  );
}

async function Gates(props: SectionProps & { canImport: boolean }) {
  const report = await loadReport(
    props.workspace,
    props.environment,
    props.days,
  );
  return (
    <GatesInsight
      report={report}
      days={props.days}
      base={basePath(props)}
      canImport={props.canImport}
    />
  );
}

async function Teams(props: SectionProps) {
  const report = await loadReport(
    props.workspace,
    props.environment,
    props.days,
  );
  return (
    <TeamsInsight report={report} days={props.days} base={basePath(props)} />
  );
}

async function Health(props: SectionProps) {
  const health = await readForPage(props.workspace, (context) =>
    getHealth(context, props.environment),
  );
  return <HealthInsight health={health} base={basePath(props)} />;
}

/**
 * Every section in page order, each loading on its own behind a placeholder
 * of its shape, so the header and window switch never wait for numbers.
 */
export function InsightSections({
  canImport,
  ...props
}: SectionProps & { canImport: boolean }) {
  return (
    <div className="grid gap-4">
      <Suspense fallback={<SectionSkeleton figures={4} />}>
        <Decisions {...props} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton figures={3} columns={3} />}>
        <Rules {...props} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton figures={2} columns={5} />}>
        <Gates {...props} canImport={canImport} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton figures={4} columns={6} />}>
        <Teams {...props} />
      </Suspense>
      <Suspense fallback={<SectionSkeleton figures={3} columns={2} />}>
        <Health {...props} />
      </Suspense>
    </div>
  );
}
