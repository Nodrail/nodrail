import type { Tour } from "./tours";

/** Tours of the screens used every day: what was stopped, what happened. */
export const workTours = {
  activity: {
    label: "Activity",
    steps: [
      {
        anchor: "activity-views",
        title: "Events one by one, or grouped by run.",
        body: "Events lists every decision and change. Runs groups them by the job an agent was doing, such as a branch or an issue.",
      },
      {
        anchor: "activity-filters",
        title: "Narrow it down.",
        body: "Filter by agent, outcome, time range or kind, or search for a request ID. The filters stay in the address, so you can share the view.",
      },
      {
        anchor: "activity-table",
        title: "Open an event for the full story.",
        body: "A side panel shows what the agent asked, what decided it and what the agent reported afterwards.",
      },
      {
        anchor: "activity-more",
        title: "More actions in ⋯.",
        body: "Each row's menu opens the request or the run behind it, shows only that agent, or starts a rule from it.",
      },
      {
        anchor: "activity-export",
        title: "Export what you see.",
        body: "Download the filtered events as CSV or JSON, for an audit or a spreadsheet.",
      },
    ],
  },
  insights: {
    label: "Insights",
    steps: [
      {
        anchor: "insights-window",
        title: "Pick a time window.",
        body: "Every section covers the last 7, 30 or 90 days in this environment.",
      },
      {
        anchor: "insights-decisions",
        title: "What the rules decided.",
        body: "How many actions were allowed and denied, and how many were denied because no rule covers them: where a rule may be missing.",
      },
      {
        anchor: "insights-rules",
        title: "Which rules do the work.",
        body: "See the rules that match most and the ones that never match, so you can tidy them up.",
      },
    ],
  },
  inventory: {
    label: "Inventory",
    steps: [
      {
        anchor: "inventory-summary",
        title: "Your team's setups at a glance.",
        body: "How many machines run a project as locked, with the policy enforced, and which drifted or went quiet.",
      },
      {
        anchor: "inventory-table",
        title: "One row per machine, project and host.",
        body: "Each session start reports counts and revisions, never files or paths. Names show only when the project shares them.",
      },
      {
        anchor: "inventory-revision",
        title: "Behind the intended revision.",
        body: "When someone publishes the locked revision with nodrail workspace publish, machines applied from another one show as behind.",
      },
    ],
  },
  overview: {
    label: "Overview",
    steps: [
      {
        anchor: "overview-health",
        title: "How things stand.",
        body: "Agents reporting, problems such as stalled steps, and this month's plan usage. A badge says when something needs a look.",
      },
      {
        anchor: "overview-trend",
        title: "The last 24 hours.",
        body: "How many actions ended each way, with the days before as small bars. Open a tile to see those events in Activity.",
      },
      {
        anchor: "overview-held",
        title: "Runs a gate or budget stopped.",
        body: "A run whose gate or budget denied its last action shows here, with what it is missing. The agent meets it and tries again.",
      },
      {
        anchor: "overview-runs",
        title: "Runs in progress.",
        body: "Jobs your agents are working on, and where each one stands. Open a run to follow it step by step.",
      },
      {
        anchor: "overview-first-steps",
        title: "First steps, while some are left.",
        body: "A new workspace lists them at the top: connect an agent, declare, plan and apply, run and watch, invite a teammate. Each one ticks itself once it is done.",
      },
    ],
  },
  run: {
    label: "Run",
    steps: [
      {
        anchor: "run-summary",
        title: "The run at a glance.",
        body: "How many steps and actions it has, how many a gate or budget stopped, and when it last moved.",
      },
      {
        anchor: "run-timeline",
        title: "Every step, in order.",
        body: "Each agent's steps as its host reported them. A finished step shows its receipt: the verdict and its findings.",
      },
      {
        anchor: "run-held",
        title: "Gates and budgets.",
        body: "An action a gate or budget denied says which one and what was missing, such as a step that has not passed yet.",
      },
      {
        anchor: "run-activity",
        title: "Every event of the run.",
        body: "Open the run's events in Activity to filter, search or export them.",
      },
    ],
  },
  event: {
    label: "Event",
    steps: [
      {
        anchor: "event-facts",
        title: "What happened.",
        body: "The agent, the action and the resource, who or what decided it, and when.",
      },
      {
        anchor: "event-why",
        title: "Why it was decided this way.",
        body: "The rule, gate or budget behind the decision, in plain words.",
      },
      {
        anchor: "event-links",
        title: "Follow it.",
        body: "Open the run the action was part of.",
      },
      {
        anchor: "event-report",
        title: "What the agent reported.",
        body: "The host's own report of how the action went. It is not independent proof.",
      },
    ],
  },
} satisfies Record<string, Tour>;
