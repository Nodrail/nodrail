import { Suspense, type ReactNode } from "react";
import { EmptyState, Panel } from "@/components/app/card";
import { FormHint, Note } from "@/components/app/note";
import { SectionHeading } from "@/components/app/section-heading";
import { PageTour } from "@/features/guidance/components/page-tour";
import { PageHeader } from "@/features/shell/components/page-header";
import { loadWorkspaceView, readForPage } from "@/features/shell/load-view";
import { deploymentMode } from "@/server/deployment";
import { getHealth } from "@/server/modules/health";
import {
  getOverviewState,
  getPlanUsage,
  getRecentDecisions,
  getToday,
} from "@/server/modules/overview";
import { listHeldRuns, listRuns } from "@/server/modules/runs";
import { getFirstSteps, readGuidance } from "@/server/modules/guidance";
import { allStepsDone, checklistKey } from "@/contracts/v1/guidance";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { COVERAGE } from "@/contracts/v1/glossary";
import { HealthTiles, allowanceReached } from "./health-tiles";
import {
  HealthSkeleton,
  ListCardSkeleton,
  OverviewBodySkeleton,
  TodaySkeleton,
  bottomGrid,
} from "./overview-skeletons";
import { RecentDecisions } from "./recent-decisions";
import { ActiveRuns, HeldRuns } from "./runs";
import { FirstSteps, FirstStepsTracker } from "./first-steps";
import { TodayCounts } from "./today";
import { settingsPath } from "@/features/shell/navigation";
import { appPath } from "@/lib/product-path";

type Place = { workspace: string; environment: string };

const baseOf = ({ workspace, environment }: Place) =>
  appPath(workspace, environment);

/** Runs a gate or budget holds now: what an agent has to meet to go on. */
async function Held(place: Place) {
  const { workspace, environment } = place;
  const held = await readForPage(workspace, (context) =>
    listHeldRuns(context, environment, 3),
  );
  if (!held.length) return null;
  return (
    <Panel data-slot="held" data-tour="overview-held">
      <HeldRuns base={baseOf(place)} runs={held} />
    </Panel>
  );
}

async function Health({
  canManageBilling,
  ...place
}: Place & { canManageBilling: boolean }) {
  const { workspace, environment } = place;
  const [health, usage] = await Promise.all([
    readForPage(workspace, (context) => getHealth(context, environment)),
    readForPage(workspace, getPlanUsage),
  ]);
  const showBilling = deploymentMode() === "cloud";
  return (
    <HealthTiles
      base={baseOf(place)}
      health={health}
      usage={usage}
      showBilling={showBilling}
      billingHref={
        canManageBilling && showBilling
          ? settingsPath(workspace, "billing")
          : null
      }
    />
  );
}

async function Today(place: Place) {
  const today = await readForPage(place.workspace, (context) =>
    getToday(context, place.environment),
  );
  return <TodayCounts base={baseOf(place)} today={today} />;
}

async function Runs(place: Place) {
  const { runs } = await readForPage(place.workspace, (context) =>
    listRuns(context, place.environment, { range: "24h" }, 5),
  );
  return <ActiveRuns base={baseOf(place)} runs={runs} />;
}

async function Decisions(place: Place) {
  const events = await readForPage(place.workspace, (context) =>
    getRecentDecisions(context, place.environment),
  );
  return <RecentDecisions base={baseOf(place)} events={events} />;
}

/**
 * An agent refused for the month's allowance never checks in, so the setup
 * guide alone would not say why; the usage tile says it once past setup.
 */
async function AllowanceNote({ workspace }: { workspace: string }) {
  const usage = await readForPage(workspace, getPlanUsage);
  return usage.actions.state === "reached" ? (
    <Note role="status" tone="warning">
      {allowanceReached}
    </Note>
  ) : null;
}

/** A labelled band of the page: its heading, then its content. */
function Band({
  title,
  tour,
  children,
}: {
  title: string;
  /** The page tour's anchor on this band. */
  tour: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} data-tour={tour}>
      <SectionHeading title={title} />
      {children}
    </section>
  );
}

/**
 * For people who set the workspace up: the first steps until all are done or
 * they set them aside, and what reports each step done.
 */
async function loadFirstSteps(view: WorkspaceViewDto, place: Place) {
  if (!view.capabilities.includes("agents:manage")) return null;
  const { steps, guidance } = await readForPage(
    place.workspace,
    async (context) => ({
      steps: await getFirstSteps(context, place.environment),
      guidance: await readGuidance(context),
    }),
  );
  const tracker = <FirstStepsTracker workspaceId={view.id} steps={steps} />;
  const open = !allStepsDone(steps) && !(checklistKey(view.id) in guidance);
  return { tracker, open, steps };
}

/**
 * One column as wide as the page, never wider: without `minmax(0, 1fr)` and
 * children allowed to shrink, the column grows to fit its longest unbreakable
 * text, such as a command, and the whole page scrolls sideways.
 */
const pageGrid = "grid grid-cols-[minmax(0,1fr)] gap-5 *:min-w-0";

/**
 * The first steps alone until an integration first checks in, an empty page
 * for people with no agents, and otherwise the overview: the first steps,
 * runs a gate holds, health, today, active runs and recent decisions, each
 * loading on its own.
 */
async function OverviewBody(place: Place) {
  const { workspace, environment } = place;
  const view = await loadWorkspaceView(workspace);
  const state = await readForPage(workspace, (context) =>
    getOverviewState(context, environment),
  );
  const first = await loadFirstSteps(view, place);
  const setup = first?.open ? (
    <FirstSteps
      base={baseOf(place)}
      workspaceBase={appPath(workspace)}
      workspaceId={view.id}
      steps={first.steps}
      checkedIn={state.checkedIn}
    />
  ) : null;
  // Until an integration checks in, the steps are the page; decisions
  // already recorded still show below them.
  if (setup && !state.checkedIn && !state.anyDecision)
    return (
      <div className={pageGrid}>
        {first?.tracker}
        <AllowanceNote workspace={workspace} />
        {setup}
      </div>
    );

  if (state.agents.connected === 0 && !state.anyDecision)
    return (
      <EmptyState title="No agents are assigned to you yet">
        Ask an admin to assign you an agent. Its decisions and activity will
        appear here.
      </EmptyState>
    );

  return (
    <div className={pageGrid}>
      {first?.tracker}
      {setup}
      <Suspense fallback={null}>
        <Held {...place} />
      </Suspense>
      <Band title="Health" tour="overview-health">
        <Suspense fallback={<HealthSkeleton />}>
          <Health
            {...place}
            canManageBilling={view.capabilities.includes("workspace:settings")}
          />
        </Suspense>
      </Band>
      <Band title="Last 24 hours" tour="overview-trend">
        <Suspense fallback={<TodaySkeleton />}>
          <Today {...place} />
        </Suspense>
      </Band>
      <div className={bottomGrid}>
        <div data-tour="overview-runs" className="grid min-w-0">
          <Suspense fallback={<ListCardSkeleton label="active runs" />}>
            <Runs {...place} />
          </Suspense>
        </div>
        <Suspense fallback={<ListCardSkeleton label="recent decisions" dot />}>
          <Decisions {...place} />
        </Suspense>
      </div>
      <FormHint>{COVERAGE}</FormHint>
      <PageTour tour="overview" ready />
    </div>
  );
}

/**
 * Overview answers, top to bottom: is anything held, is everything healthy,
 * and what has been happening. The layout has already checked the
 * workspace and environment, so nothing here can reject the address and the
 * header renders at once while each section loads behind its own skeleton.
 */
export async function OverviewView(place: Place) {
  const view = await loadWorkspaceView(place.workspace);
  const environmentName =
    view.environments.find((item) => item.slug === place.environment)?.name ??
    place.environment;
  return (
    <>
      <PageHeader
        title="Overview"
        purpose={`How things stand, the runs a gate or budget stopped, and what happened in ${environmentName}.`}
      />
      <Suspense fallback={<OverviewBodySkeleton />}>
        <OverviewBody {...place} />
      </Suspense>
    </>
  );
}
