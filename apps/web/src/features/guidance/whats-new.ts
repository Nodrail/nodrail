/**
 * What changed in the product, newest first. Entries have no date: the order
 * says what is new. Add new ones at the top with an id never used before;
 * the Help menu shows a dot until a person has opened the list since.
 */
export type WhatsNewEntry = {
  id: string;
  title: string;
  body: string;
  /** Where to see it, as a page below the environment, such as `/activity`. */
  link?: { label: string; path: string };
};

export const whatsNew: readonly WhatsNewEntry[] = [
  {
    id: "control-plane",
    title: "Set up hosts from nodrail.yaml",
    body: "Declare the policy in nodrail.yaml and copy the command from Connect a project to sign in and review the plan. Apply publishes the policy here and installs the hook.",
    link: { label: "Connect a project", path: "/agents/connect" },
  },
  {
    id: "no-approvals",
    title: "Rules allow or deny",
    body: "A rule allows or denies. A gate or budget denies with what is missing until it is met, so the agent fixes it and tries again.",
    link: { label: "Open Policies", path: "/policies" },
  },
  {
    id: "gates-budgets-forms",
    title: "Gates and budgets, each in its own tab",
    body: "Policies now has Rules, Gates and Budgets tabs. Add, edit and remove gates and budgets in forms, like rules.",
    link: { label: "Open Gates", path: "/policies/gates" },
  },
  {
    id: "settings-menus",
    title: "Settings and your account, in the menus",
    body: "Workspace settings and members open from the workspace menu, top left. Notifications, API tokens and privacy are under your avatar.",
  },
  {
    id: "short-urls",
    title: "Shorter links",
    body: "Product pages drop /app from their address. Old links still work.",
  },
  {
    id: "new-overview",
    title: "A new Overview",
    body: "Overview opens with runs a gate holds, then health and the last 24 hours.",
    link: { label: "Open Overview", path: "/overview" },
  },
  {
    id: "insights",
    title: "Insights",
    body: "See what the rules decided, and which rules do the work.",
    link: { label: "Open Insights", path: "/insights" },
  },
  {
    id: "activity-export",
    title: "One Activity page, with export",
    body: "Events and runs share one page and one set of filters, and export to CSV or JSON.",
    link: { label: "Open Activity", path: "/activity" },
  },
  {
    id: "rules-yaml",
    title: "Rules as YAML",
    body: "Read and edit every rule as one YAML file, checked as you type.",
    link: { label: "Open the YAML view", path: "/policies/yaml" },
  },
];

/** Whether there is an entry newer than the last one this person read. */
export function hasUnread(lastRead: string | null | undefined) {
  const [latest] = whatsNew;
  return Boolean(latest && latest.id !== lastRead);
}
