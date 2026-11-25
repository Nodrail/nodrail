import {
  Bot,
  ChartColumn,
  LayoutGrid,
  List,
  MonitorCheck,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceViewDto } from "@/contracts/v1/workspaces";
import { appPath } from "@/lib/product-path";

export type ShellSection = {
  slug: string;
  label: string;
  icon: LucideIcon;
  purpose: string;
};

export const workspaceSections: ShellSection[] = [
  {
    slug: "overview",
    label: "Overview",
    icon: LayoutGrid,
    purpose: "How things stand, and the runs a gate or budget stopped.",
  },
  {
    slug: "agents",
    label: "Agents",
    icon: Bot,
    purpose: "The agents connected to this environment, and their hosts.",
  },
  {
    slug: "activity",
    label: "Activity",
    icon: List,
    purpose:
      "What your agents did: each decision, or whole runs with their steps.",
  },
  {
    slug: "inventory",
    label: "Inventory",
    icon: MonitorCheck,
    purpose:
      "Which setups your team's machines run, and whether each one is as locked, with the policy enforced.",
  },
  {
    slug: "policies",
    label: "Policies",
    icon: ShieldCheck,
    purpose: "The rules, gates and budgets that allow or deny each action.",
  },
  {
    slug: "insights",
    label: "Insights",
    icon: ChartColumn,
    purpose:
      "What the rules decided, which rules do the work, what is stuck, and how runs went.",
  },
];

export const allSections = workspaceSections;

/** A page of workspace settings or of your account, below the workspace. */
export type ManagePage = {
  slug: string;
  label: string;
  purpose: string;
  /** Its link's `data-tour` anchor in the side menu. */
  tour: string;
  /** Who sees the page; the server checks the same before it renders. */
  shown?: (view: Pick<WorkspaceViewDto, "capabilities" | "isOwner">) => boolean;
};

const managesSettings = (view: Pick<WorkspaceViewDto, "capabilities">) =>
  view.capabilities.includes("workspace:settings");

/** `/<workspace>/settings/<page>`: the workspace itself, in no environment. */
export const settingsPages = [
  {
    slug: "general",
    tour: "settings-general",
    label: "General",
    purpose: "The workspace's name and the environment it opens in.",
  },
  {
    slug: "members",
    tour: "settings-members",
    label: "Members",
    purpose: "Choose who can manage this workspace and its policies.",
  },
  {
    slug: "billing",
    tour: "settings-billing",
    label: "Billing & usage",
    purpose: "The plan, this month's usage and payment.",
    shown: managesSettings,
  },
  {
    slug: "data",
    tour: "settings-data",
    label: "Data",
    purpose: "Download everything this workspace holds, or archive it.",
    shown: (view) => managesSettings(view) || view.isOwner,
  },
] as const satisfies readonly ManagePage[];

/** `/<workspace>/account/<page>`: your own choices in this workspace. */
export const accountPages = [
  {
    slug: "notifications",
    tour: "account-notifications",
    label: "Notifications",
    purpose: "Which emails you get from this workspace.",
  },
  {
    slug: "tokens",
    tour: "account-tokens",
    label: "API tokens",
    purpose:
      "Tokens for the API, the nodrail command line and the MCP server, acting as you.",
  },
  {
    slug: "privacy",
    tour: "account-privacy",
    label: "Privacy & your data",
    purpose:
      "Cookies, what Nodrail keeps about you, and deleting your account.",
  },
] as const satisfies readonly ManagePage[];

export type SettingsPage = (typeof settingsPages)[number]["slug"];
export type AccountPage = (typeof accountPages)[number]["slug"];

/** Whether this person may open the page. */
export const canOpen = (
  page: ManagePage,
  view: Pick<WorkspaceViewDto, "capabilities" | "isOwner">,
  showBilling = true,
) => (showBilling || page.slug !== "billing") && (page.shown?.(view) ?? true);

export const settingsPath = (workspace: string, page: SettingsPage) =>
  appPath(workspace, "settings", page);

export const accountPath = (workspace: string, page: AccountPage) =>
  appPath(workspace, "account", page);

export const roleLabels = {
  admin: "Admin",
  policy_manager: "Policy manager",
  viewer: "Viewer",
} as const;
